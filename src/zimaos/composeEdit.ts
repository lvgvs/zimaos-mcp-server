import { AppError } from "../errors.js";
import { parseCompose, type ParseComposeResult } from "../compose/parse.js";
import { compareComposeRisk } from "../compose/riskDelta.js";
import { sourceFingerprint } from "../approval/intent.js";
import type { ZimaOsClient } from "./client.js";
import type { PermissionLayer } from "../permissions.js";
import type { ChallengeLedger } from "../approval/challengeLedger.js";
import { assertEditIntentsMatch } from "../approval/editIntent.js";
import {
  parsePendingEditPayload,
  type PendingEditPayload,
} from "../approval/requestState.js";
import { targetIdentityDigest } from "../approval/intent.js";

const SAFE_APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** Shared by all MCP sessions in this process; not an upstream CAS. */
const editQueues = new Map<string, Promise<void>>();
const pendingEdits = new Map<string, string>();
const MAX_PENDING_EDITS = 4096;
function withAppEditLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = editQueues.get(id) ?? Promise.resolve();
  const started = previous.then(task);
  const settled = started.then(
    () => undefined,
    () => undefined,
  );
  editQueues.set(id, settled);
  void settled.then(() => {
    if (editQueues.get(id) === settled) editQueues.delete(id);
  });
  return started;
}

function assertDryRunReady(
  validation: Awaited<ReturnType<ComposeEditService["validate"]>>,
): void {
  if (
    !validation.upstream.accepted ||
    (validation.upstream.portsInUse ?? []).length > 0
  ) {
    throw new AppError(
      validation.upstream.status === "upstream_error"
        ? "ZIMAOS_UPSTREAM_ERROR"
        : "ZIMAOS_BAD_REQUEST",
      "Existing-app Compose dry-run did not pass.",
    );
  }
}

function assertId(id: string): void {
  if (!SAFE_APP_ID.test(id)) {
    throw new AppError("INPUT_INVALID", "A valid explicit application id is required.");
  }
}
function parse(source: string): ParseComposeResult {
  try {
    return parseCompose(source);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("compose parse failed:")) {
      throw new AppError("INPUT_INVALID", error.message);
    }
    throw new AppError("INPUT_INVALID", "Invalid Compose document.");
  }
}
function assertIdentity(parsed: ParseComposeResult, id: string): void {
  if (parsed.name !== id) {
    throw new AppError(
      "INPUT_INVALID",
      "Compose project name must match the existing app id.",
    );
  }
}
function comparable(value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()].map(([key, entry]) => [key, comparable(entry)]);
  }
  if (Array.isArray(value)) return value.map(comparable);
  return value;
}
/** Fail closed rather than returning the MCP server's own ZimaOS credential. */
function assertNoZimaOsCredential(parsed: ParseComposeResult): void {
  const services = parsed.document.get("services");
  if (!(services instanceof Map)) return;
  for (const definition of services.values()) {
    if (!(definition instanceof Map)) continue;
    const env = definition.get("environment");
    const keys = env instanceof Map ? [...env.keys()] : Array.isArray(env) ? env : [];
    if (
      keys.some((key) =>
        /^ZIMAOS_(PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN)(=|$)/i.test(String(key)),
      )
    ) {
      throw new AppError(
        "PERMISSION_DENIED",
        "Compose contains ZimaOS credentials and cannot be returned through MCP.",
      );
    }
  }
}

export interface CurrentAppCompose {
  app_id: string;
  /** Official GET is an interpolated/reformatted representation, not stored source. */
  representation: "interpolated_yaml";
  source: string;
  fingerprint: string;
}

export class ComposeEditService {
  constructor(private readonly client: ZimaOsClient) {}

  async read(id: string): Promise<CurrentAppCompose> {
    assertId(id);
    const source = await this.client.getComposeAppYaml(id);
    const parsed = parse(source);
    assertIdentity(parsed, id);
    assertNoZimaOsCredential(parsed);
    return {
      app_id: id,
      representation: "interpolated_yaml",
      source,
      fingerprint: sourceFingerprint(source),
    };
  }

  async validate(id: string, expectedFingerprint: string, proposedSource: string) {
    assertId(id);
    if (!FINGERPRINT.test(expectedFingerprint)) {
      throw new AppError("INPUT_INVALID", "A valid base fingerprint is required.");
    }
    const base = await this.read(id);
    if (base.fingerprint !== expectedFingerprint) {
      throw new AppError(
        "ZIMAOS_BAD_REQUEST",
        "The application Compose changed; re-read before editing.",
      );
    }
    const current = parse(base.source);
    const proposed = parse(proposedSource);
    assertIdentity(proposed, id);
    let risks;
    try {
      risks = compareComposeRisk(current, proposed);
    } catch {
      throw new AppError("INPUT_INVALID", "Compose risk analysis failed.");
    }
    const validation = await this.client.validateComposeChange(id, proposedSource);
    const currentServices = current.document.get("services");
    const proposedServices = proposed.document.get("services");
    const oldNames = currentServices instanceof Map ? [...currentServices.keys()] : [];
    const newNames = proposedServices instanceof Map ? [...proposedServices.keys()] : [];
    return {
      app_id: id,
      baseFingerprint: base.fingerprint,
      proposedFingerprint: sourceFingerprint(proposedSource),
      upstream: validation,
      changes: {
        addedServices: newNames.filter((name) => !oldNames.includes(name)),
        removedServices: oldNames.filter((name) => !newNames.includes(name)),
        changedServices: newNames.filter(
          (name) =>
            oldNames.includes(name) &&
            JSON.stringify(
              comparable(
                proposedServices instanceof Map ? proposedServices.get(name) : null,
              ),
            ) !==
              JSON.stringify(
                comparable(
                  currentServices instanceof Map ? currentServices.get(name) : null,
                ),
              ),
        ),
      },
      risks,
    };
  }

  /** Benign existing-app edit. Risk increases cannot pass this route. */
  async edit(
    id: string,
    expectedFingerprint: string,
    proposedSource: string,
    permissions: PermissionLayer,
  ) {
    permissions.assertCanEdit();
    const initial = await this.validate(id, expectedFingerprint, proposedSource);
    assertDryRunReady(initial);
    if (initial.risks.requiresApproval) {
      return { status: "confirmation_required" as const, risks: initial.risks };
    }
    return withAppEditLock(id, () =>
      this.applyLocked(id, expectedFingerprint, proposedSource, permissions),
    );
  }

  /** Only verified signed native continuations may call this approval path. */
  async editApproved(
    id: string,
    expectedFingerprint: string,
    proposedSource: string,
    permissions: PermissionLayer,
    verifiedState: PendingEditPayload,
    target: string,
    principal: string,
    ledger: ChallengeLedger,
  ) {
    permissions.assertCanEdit();
    const state = parsePendingEditPayload(verifiedState);
    if (
      state.appId !== id ||
      state.baseFingerprint !== expectedFingerprint ||
      state.contentSha256 !== sourceFingerprint(proposedSource) ||
      state.targetDigest !== targetIdentityDigest(target)
    ) {
      throw new AppError("INPUT_INVALID", "The approved Compose edit no longer matches.");
    }
    if (ledger.inspect(state.challengeId).state !== "pending") {
      throw new AppError("INPUT_INVALID", "The approval challenge is no longer pending.");
    }
    return withAppEditLock(id, async () => {
      const fresh = await this.validate(id, expectedFingerprint, proposedSource);
      assertDryRunReady(fresh);
      if (!fresh.risks.requiresApproval) {
        throw new AppError(
          "INPUT_INVALID",
          "The approved risk disclosure is no longer applicable.",
        );
      }
      assertEditIntentsMatch(state, {
        id,
        baseFingerprint: expectedFingerprint,
        source: proposedSource,
        risks: fresh.risks,
        target,
      });
      return this.applyLocked(
        id,
        expectedFingerprint,
        proposedSource,
        permissions,
        () => {
          ledger.consume(state.challengeId, {
            tool: "edit_app_compose",
            contentFingerprint: state.contentSha256,
            principal,
          });
        },
      );
    });
  }

  private async applyLocked(
    id: string,
    expectedFingerprint: string,
    proposedSource: string,
    permissions: PermissionLayer,
    consume?: () => void,
  ) {
    const current = await this.read(id);
    if (current.fingerprint !== expectedFingerprint) {
      throw new AppError(
        "ZIMAOS_BAD_REQUEST",
        "The application Compose changed; re-read before editing.",
      );
    }
    const pendingBase = pendingEdits.get(id);
    if (pendingBase !== undefined && pendingBase !== current.fingerprint) {
      pendingEdits.delete(id);
    } else if (pendingBase !== undefined) {
      throw new AppError(
        "ZIMAOS_BAD_REQUEST",
        "An earlier edit outcome is pending; re-read before editing.",
      );
    }
    permissions.assertCanEdit();
    if (pendingEdits.size >= MAX_PENDING_EDITS) {
      throw new AppError("INTERNAL", "Pending edit capacity is exhausted.");
    }
    // A lagging GET must not allow a second real PUT with the same base.
    pendingEdits.set(id, expectedFingerprint);
    try {
      consume?.();
    } catch (error) {
      pendingEdits.delete(id);
      throw error;
    }
    let outcome: { status: "accepted" | "rejected" | "upstream_error" };
    let errorCode: string | undefined;
    try {
      outcome = await this.client.applyComposeChangeOnce(id, proposedSource);
    } catch (error) {
      if (error instanceof AppError) errorCode = error.code;
      outcome = { status: "upstream_error" };
    }
    if (outcome.status === "rejected") pendingEdits.delete(id);
    let observation: "changed" | "pending" | "unavailable" = "unavailable";
    try {
      const observed = await this.read(id);
      observation = observed.fingerprint === expectedFingerprint ? "pending" : "changed";
      if (observation === "changed") pendingEdits.delete(id);
    } catch {
      // A read failure must never cause a mutation retry.
    }
    return {
      status: outcome.status,
      observation,
      baseFingerprint: expectedFingerprint,
      ...(errorCode ? { errorCode } : {}),
    };
  }
}
