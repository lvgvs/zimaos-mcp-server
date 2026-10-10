/**
 * Application domain service.
 *
 * Wraps the ZimaOS app-management client and returns normalized domain models.
 * All upstream failures are mapped to AppError with stable codes; raw payloads
 * never leak past this layer (AGENTS.md).
 */

import { AppError, isRecord } from "../errors.js";
import { resolveStoreCompose } from "./storeResolver.js";
import { assertStoreSelection, type StoreSelection } from "./storeCatalog.js";

import type {
  HealthProbeResult,
  ZimaOsClient,
  ComposeUninstallResult,
} from "./client.js";
import type { ComposeValidationResult } from "./client.js";
import type { PermissionLayer } from "../permissions.js";
import { analyzeCompose, type RiskFinding } from "../compose/analyze.js";
import { parseCompose } from "../compose/parse.js";
import { preflightInstall } from "./installPreflight.js";
import { ComposeEditService } from "./composeEdit.js";
import type { PendingEditPayload } from "../approval/requestState.js";
import type { ChallengeLedger } from "../approval/challengeLedger.js";
import {
  assertPendingInstallIntentsMatch,
  assertStoreInstallIntentsMatch,
  sourceFingerprint,
} from "../approval/intent.js";
import {
  parsePendingInstallPayload,
  parsePendingStoreInstallPayload,
  type PendingStoreInstallPayload,
  type PendingInstallPayload,
} from "../approval/requestState.js";
import {
  normalizeAppList,
  normalizeContainers,
  type AppInfo,
  type ContainerInfo,
} from "../domain/models.js";

/**
 * Bounded structured result of a non-mutating Compose validation.
 * Extends the client's dry-run outcome with local risk findings; every field
 * is fixed-shape and never carries raw upstream or source text.
 */
export interface ValidateComposeResult extends ComposeValidationResult {
  /** Local analyzer findings (empty for benign documents). */
  readonly findings: RiskFinding[];
}

/** Limit validation disclosure and later approval challenge size. */
const MAX_RISK_FINDINGS = 256;

/**
 * In-process safe-install serialization lock (Phase 2C).
 *
 * The whole `installSafeCompose` body — permission check, duplicate-identity
 * recheck against a fresh app list, dry run, and the single real install POST
 * — runs under this process-wide queue so concurrent requests in one server
 * process can never race each other's duplicate detection (docs/RESEARCH.md:
 * "under an install lock, recheck collisions ... then at most one real
 * POST"). The chain always settles to `undefined` after every task, so the
 * lock is released on success, on a rejected/upstream_error outcome, and on
 * any thrown error — including a timed-out attempt. There is no retry anywhere
 * in this path and no bypass: every install goes through the same queue.
 */
let installChain: Promise<void> = Promise.resolve();

function runInstallExclusive<T>(task: () => Promise<T>): Promise<T> {
  const started = installChain.then(task);
  // Keep the chain itself always-resolving so one failed, rejected, or
  // timed-out install never blocks every later install.
  installChain = started.then(
    () => undefined,
    () => undefined,
  );
  return started;
}

/**
 * Process-wide install-name reservations (Phase 2C).
 *
 * The host app list may lag behind an accepted asynchronous install, so a
 * fresh list read alone cannot stop a second same-name POST. Each ready
 * preflight therefore reserves its exact normalized name here before the
 * single real install POST; while reserved, any further same-name request
 * fails closed locally (fixed AppError ZIMAOS_BAD_REQUEST) with zero
 * additional real POSTs — even when its own fresh list read is stale.
 *
 * Reservation lifetime: kept for accepted, upstream_error, and thrown/timeout
 * outcomes (the attempt may have landed); released only on a definitive
 * rejected outcome. A known pre-POST failure never reserves anything because
 * the reservation happens after the ready preflight result.
 *
 * The set is bounded fail-closed: once `MAX_RESERVED_INSTALL_NAMES` distinct
 * names are reserved, further reservations throw instead of growing without
 * bound (a definitive rejection frees its slot again). This is local
 * process-wide state only; it does not claim atomicity against actors outside
 * this server process.
 */
const MAX_RESERVED_INSTALL_NAMES = 4096;

/** Lower-cased normalized names with an in-flight or accepted install. */
const reservedInstallNames = new Set<string>();
const reservedNativeAppIds = new Set<string>();

type StoreInstallResult =
  | {
      status: "confirmation_required";
      source: string;
      name: string;
      findings: RiskFinding[];
    }
  | {
      status: "accepted" | "rejected" | "upstream_error";
      accepted: boolean;
      reconciliation?: "observed" | "pending" | "unknown";
      appId?: string;
      health?: HealthProbeResult["state"];
      containerCount?: number;
    };

/** Fixed sanitized message: the name is already reserved by another request. */
const RESERVED_NAME_MESSAGE =
  "An install for this application name is already in flight on this server.";

/** Fixed sanitized message: the bounded reservation table is full. */
const RESERVATION_CAPACITY_MESSAGE =
  "Install name reservations are exhausted; no further installs can be started.";

function normalizeReservedName(name: string): string {
  return name.toLowerCase();
}

/**
 * Reserve an exact normalized install name before its real POST. Fail closed
 * if already reserved, even if a caller skips the earlier availability check.
 * Fails closed when the bounded table is full and the name is not yet in it.
 */
function reserveInstallName(name: string): void {
  const key = normalizeReservedName(name);
  if (reservedInstallNames.has(key)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", RESERVED_NAME_MESSAGE);
  }
  if (reservedInstallNames.size >= MAX_RESERVED_INSTALL_NAMES) {
    throw new AppError("INTERNAL", RESERVATION_CAPACITY_MESSAGE);
  }
  reservedInstallNames.add(key);
}

/** Release a name after a definitive rejected outcome. */
function releaseInstallName(name: string): void {
  reservedInstallNames.delete(normalizeReservedName(name));
}

/** True when the exact normalized name is currently reserved (lower-cased). */
function isInstallNameReserved(name: string): boolean {
  return reservedInstallNames.has(normalizeReservedName(name));
}

function assertInstallNameAvailable(name: string): void {
  if (isInstallNameReserved(name)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", RESERVED_NAME_MESSAGE);
  }
}

/**
 * Fixed-shape outcome of `AppService.installSafeCompose`.
 *
 * - "confirmation_required": preflight found local risk findings; the caller
 *   must present them and obtain explicit user confirmation before any install.
 *   No mutation happened on this path (approval is a later slice).
 * - "accepted" / "rejected" / "upstream_error": exactly one real install
 *   attempt was made and its acceptance outcome is reported as data.
 *   "accepted" means ZimaOS accepted the asynchronous request — it is NOT
 *   completion, and no app ID can be inferred from this result.
 */
export type InstallSafeResult =
  | {
      readonly status: "confirmation_required";
      /** The exact top-level compose name from the document (verbatim). */
      readonly name: string;
      /** Local analyzer findings requiring explicit user confirmation. */
      readonly findings: RiskFinding[];
    }
  | {
      readonly status: "accepted" | "rejected" | "upstream_error";
      /** True only for an accepted (asynchronous) install request; never implies completion. */
      readonly accepted: boolean;
    };

/** Asynchronous acceptance plus at most one read-only observation. */
export type UninstallResult = ComposeUninstallResult & {
  readonly reconciliation?: "absent" | "pending";
};

const MAX_RESERVED_UNINSTALL_IDS = 4096;
const reservedUninstallIds = new Set<string>();
const SAFE_APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Normalize a local parser/analyzer failure into an AppError without echoing
 * input content: only the modules' own sanitized reason phrases are passed
 * through; anything else becomes a fixed generic message.
 */
function toLocalValidationError(err: unknown, stage: "parse" | "analyze"): AppError {
  const prefix = `compose ${stage} failed:`;
  if (err instanceof Error && err.message.startsWith(prefix)) {
    return new AppError("INPUT_INVALID", err.message);
  }
  return new AppError("INPUT_INVALID", `${prefix} invalid document`);
}

export class AppService {
  constructor(private readonly client: ZimaOsClient) {}

  /** Read the authoritative interpolated Compose representation and its digest. */
  async getAppCompose(id: string) {
    return new ComposeEditService(this.client).read(id);
  }

  /** Validate an exact proposed existing-app edit without mutation. */
  async validateAppComposeChange(id: string, fingerprint: string, source: string) {
    return new ComposeEditService(this.client).validate(id, fingerprint, source);
  }

  async editAppCompose(
    id: string,
    fingerprint: string,
    source: string,
    permissions: PermissionLayer,
  ) {
    return new ComposeEditService(this.client).edit(id, fingerprint, source, permissions);
  }

  async editApprovedAppCompose(
    id: string,
    fingerprint: string,
    source: string,
    permissions: PermissionLayer,
    state: PendingEditPayload,
    target: string,
    principal: string,
    ledger: ChallengeLedger,
  ) {
    return new ComposeEditService(this.client).editApproved(
      id,
      fingerprint,
      source,
      permissions,
      state,
      target,
      principal,
      ledger,
    );
  }

  /** List all installed compose applications (normalized summaries). */
  async listApps(): Promise<AppInfo[]> {
    const data = await this.client.listComposeApps();
    return normalizeAppList(data);
  }

  /** Uninstall an explicit installed id with one DELETE and a bounded read-only observation. */
  async uninstallApp(id: string, permissions: PermissionLayer): Promise<UninstallResult> {
    return runInstallExclusive(async () => {
      permissions.assertCanUninstall("uninstall_app");
      if (typeof id !== "string" || !SAFE_APP_ID.test(id)) {
        throw new AppError(
          "INPUT_INVALID",
          "A valid explicit application id is required.",
        );
      }
      if (reservedUninstallIds.has(id)) {
        throw new AppError(
          "ZIMAOS_BAD_REQUEST",
          "An uninstall for this id was already attempted.",
        );
      }
      const apps = await this.listApps();
      if (!apps.some((app) => app.id === id)) {
        throw new AppError(
          "ZIMAOS_NOT_FOUND",
          "The application id was not found on the host.",
        );
      }
      if (reservedUninstallIds.size >= MAX_RESERVED_UNINSTALL_IDS) {
        throw new AppError("INTERNAL", "Uninstall reservations are exhausted.");
      }
      reservedUninstallIds.add(id);
      // A thrown post-attempt error is ambiguous; retain the reservation.
      const result = await this.client.uninstallComposeOnce(id);
      if (result.status === "rejected") {
        reservedUninstallIds.delete(id);
        return result;
      }
      if (result.status !== "accepted") return result;
      // One read only. Failure or stale listing means pending, not retryable.
      let reconciliation: "absent" | "pending" = "pending";
      try {
        const latest = await this.listApps();
        if (!latest.some((app) => app.id === id)) reconciliation = "absent";
      } catch {
        // The DELETE acceptance is authoritative; a failed read is not proof.
      }
      return { ...result, reconciliation };
    });
  }

  /** Fetch a single application by id. Throws APP_NOT_FOUND when absent. */
  async getApp(id: string): Promise<AppInfo> {
    const apps = await this.listApps();
    const found = apps.find((app) => app.id === id);
    if (found === undefined) {
      throw new AppError(
        "ZIMAOS_NOT_FOUND",
        `Application "${id}" is not installed on the ZimaOS host.`,
      );
    }
    return found;
  }

  /**
   * Health for one application: the app's own health endpoint plus per-container
   * state/health from the containers API (never invented).
   */
  async getAppHealth(id: string): Promise<{
    app: string;
    probe: HealthProbeResult;
    containers: ContainerInfo[];
  }> {
    const [probe, containers] = await Promise.all([
      this.client.probeComposeAppHealth(id),
      this.listContainers(id).catch(() => [] as ContainerInfo[]),
    ]);
    return { app: id, probe, containers };
  }

  /**
   * Fetch bounded container logs for an application. Returns the raw log text;
   * callers bound `lines` (see tools) and document that app logs may contain
   * sensitive data outside this server's control.
   */
  async getLogs(id: string, lines: number): Promise<string> {
    const data = await this.client.getComposeAppLogs(id, lines);
    if (typeof data === "string") return data;
    if (data === null || data === undefined) return "";
    // Defensive: some versions may wrap logs in an object.
    if (typeof data === "object" && !Array.isArray(data)) {
      const rec = data as Record<string, unknown>;
      if (typeof rec["logs"] === "string") return rec["logs"];
      if (Array.isArray(rec["lines"])) {
        return (rec["lines"] as unknown[]).map((line) => String(line)).join("\n");
      }
    }
    return JSON.stringify(data);
  }

  /** List containers belonging to an application. */
  async listContainers(id: string): Promise<ContainerInfo[]> {
    const data = await this.client.getComposeAppContainers(id);
    return normalizeContainers(data);
  }

  /** Start an application (control operation). */
  async startApp(id: string): Promise<void> {
    await this.client.setComposeAppStatus(id, "start");
  }

  /** Stop an application (control operation). */
  async stopApp(id: string): Promise<void> {
    await this.client.setComposeAppStatus(id, "stop");
  }

  /** Restart an application (control operation). */
  async restartApp(id: string): Promise<void> {
    await this.client.setComposeAppStatus(id, "restart");
  }

  /**
   * Validate a Docker Compose document without installing or mutating anything.
   *
   * Pipeline: `parseCompose` -> `analyzeCompose` (local risk findings) -> one
   * non-mutating dry-run via the client with the exact original source string,
   * unchanged. Local parser/analyzer rejections short-circuit as AppError
   * INPUT_INVALID before any upstream call; validation outcomes (accepted /
   * rejected / ambiguous upstream failure) are returned as data. Client
   * transport/auth failures propagate as their AppErrors. No name is required.
   */
  async validateCompose(source: string, native = false): Promise<ValidateComposeResult> {
    let parsed;
    try {
      parsed = parseCompose(source);
    } catch (err) {
      throw toLocalValidationError(err, "parse");
    }

    let findings: RiskFinding[];
    try {
      findings = analyzeCompose(parsed);
    } catch (err) {
      throw toLocalValidationError(err, "analyze");
    }

    if (findings.length > MAX_RISK_FINDINGS) {
      throw new AppError(
        "INPUT_INVALID",
        "compose analyze failed: too many risk findings",
      );
    }

    // The exact original source reaches the dry run unchanged.
    const validation = native
      ? await this.client.validateNativeStoreCompose(source)
      : await this.client.validateCompose(source);
    return { ...validation, findings };
  }

  /**
   * Safe installation service (Phase 2C) — no approval logic in this slice.
   *
   * Runs `preflightInstall` first: with the default-off install permission it
   * throws before any upstream traffic; a duplicate identity, an unparseable
   * document, a rejected dry run, an ambiguous upstream failure, or a host port
   * conflict all fail closed as normalized AppErrors. A preflight result of
   * `confirmation_required` (local risk findings) is returned unchanged and
   * NEVER mutates: no install POST is sent on that path. Only a `ready` result
   * proceeds to exactly one real install attempt via
   * `client.installComposeOnce(source)` — the exact original source, never
   * retried after the POST (the client itself guarantees at most one attempt).
   *
   * The returned outcome is a fixed-shape asynchronous acceptance signal, not
   * claimed completion: no app ID or installed state can be inferred from it.
   *
   * Concurrency (Phase 2C): the entire body — permission check, duplicate
   * recheck against a fresh list read, dry run, and the single real POST —
   * runs under an in-process serialization lock shared by every AppService
   * instance in this server process. The host app list may lag behind an
   * accepted asynchronous install, so the fresh list read alone cannot stop a
   * second same-name POST: after a ready preflight and before the real POST
   * the exact normalized name is reserved process-wide (see
   * `reserveInstallName`), and any further same-name request fails closed with
   * a fixed AppError ZIMAOS_BAD_REQUEST — zero additional dry runs, zero
   * additional real POSTs — even when its own fresh list read is stale. The
   * reservation is kept for accepted, upstream_error, and thrown/timeout
   * outcomes (the attempt may have landed) and released only on a definitive
   * rejected outcome; a known pre-POST failure reserves nothing, so it never
   * poisons the name. Different names reserve independently and proceed under
   * the same serialization: each performs its own fresh list read, dry run,
   * reservation, and single real POST after the previous request fully
   * completes. There is no retry anywhere in this path and no bypass — every
   * install goes through the same queue. This is local process-wide state only;
   * it does not claim atomicity against actors outside this server process.
   */
  async installSafeCompose(
    source: string,
    permissions: PermissionLayer,
  ): Promise<InstallSafeResult> {
    return runInstallExclusive(async () => {
      const preflight = await preflightInstall(
        source,
        this,
        permissions,
        assertInstallNameAvailable,
      );
      if (preflight.status === "confirmation_required") {
        return {
          status: "confirmation_required" as const,
          name: preflight.name,
          findings: preflight.findings,
        };
      }

      // Ready: reserve after all read-only checks and before the real POST.
      return this.attemptInstallOnce(source, preflight.name);
    });
  }

  /** Only explicit catalog identities enter; final source stays internal. */
  async installStoreApp(
    selection: StoreSelection,
    permissions: PermissionLayer,
  ): Promise<StoreInstallResult> {
    return runInstallExclusive(() => this.installStoreLocked(selection, permissions));
  }

  async installApprovedStoreApp(
    selection: StoreSelection,
    permissions: PermissionLayer,
    state: PendingStoreInstallPayload,
    target: string,
    principal: string,
    ledger: ChallengeLedger,
  ): Promise<StoreInstallResult> {
    return runInstallExclusive(() =>
      this.installStoreLocked(selection, permissions, {
        state,
        target,
        principal,
        ledger,
      }),
    );
  }

  private async installStoreLocked(
    selection: StoreSelection,
    permissions: PermissionLayer,
    approval?: {
      state: PendingStoreInstallPayload;
      target: string;
      principal: string;
      ledger: ChallengeLedger;
    },
  ): Promise<StoreInstallResult> {
    permissions.assertCanInstall("install_app_from_store");
    assertStoreSelection(selection);
    const state = approval ? parsePendingStoreInstallPayload(approval.state) : undefined;
    if (reservedNativeAppIds.has(selection.appId)) {
      throw new AppError(
        "ZIMAOS_BAD_REQUEST",
        "An install for this catalog identity was already attempted.",
      );
    }
    const resolved = await resolveStoreCompose(this.client, selection);
    const preflight = await preflightInstall(
      resolved.source,
      {
        listApps: () => this.listNativeInstalledApps(),
        validateCompose: (source) => this.validateCompose(source, true),
      },
      permissions,
      assertInstallNameAvailable,
      (apps) => this.assertNativeAssociationAvailable(apps, selection),
    );
    if (state && approval) {
      if (preflight.status !== "confirmation_required") {
        throw new AppError(
          "INPUT_INVALID",
          "The approved risk disclosure is no longer applicable.",
        );
      }
      assertStoreInstallIntentsMatch(state, {
        source: resolved.source,
        name: preflight.name,
        findings: preflight.findings,
        selection,
        target: approval.target,
      });
      approval.ledger.consume(state.challengeId, {
        tool: state.tool,
        contentFingerprint: state.contentSha256,
        principal: approval.principal,
      });
    } else if (preflight.status === "confirmation_required") {
      return {
        status: "confirmation_required",
        source: resolved.source,
        name: preflight.name,
        findings: preflight.findings,
      };
    }
    const install = await this.attemptInstallOnce(
      resolved.source,
      preflight.name,
      selection.appId,
    );
    if (install.status !== "accepted") return install;
    return { ...install, ...(await this.observeNativeInstall(preflight.name)) };
  }

  private async listNativeInstalledApps(): Promise<AppInfo[]> {
    const data = await this.client.listComposeApps();
    if (
      !isRecord(data) ||
      Object.keys(data).length > 128 ||
      Object.entries(data).some(
        ([id, entry]) => !SAFE_APP_ID.test(id) || !isRecord(entry),
      )
    ) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Installed identities could not be verified safely.",
      );
    }
    return normalizeAppList(data);
  }

  private async assertNativeAssociationAvailable(
    apps: AppInfo[],
    selection: StoreSelection,
  ): Promise<void> {
    for (const app of apps) {
      let association;
      try {
        association = await this.client.getComposeAppAssociation(app.id);
      } catch {
        throw new AppError(
          "ZIMAOS_UPSTREAM_ERROR",
          "Installed associations could not be verified safely.",
        );
      }
      if (association.appId === selection.appId) {
        throw new AppError(
          "ZIMAOS_BAD_REQUEST",
          "This catalog application is already associated with an installed app.",
        );
      }
    }
  }

  private async observeNativeInstall(name: string): Promise<{
    reconciliation: "observed" | "pending" | "unknown";
    appId?: string;
    health?: HealthProbeResult["state"];
    containerCount?: number;
  }> {
    try {
      const apps = await this.listNativeInstalledApps();
      if (!apps.some((app) => app.id === name)) return { reconciliation: "pending" };
      const result: {
        reconciliation: "observed";
        appId: string;
        health?: HealthProbeResult["state"];
        containerCount?: number;
      } = { reconciliation: "observed", appId: name };
      try {
        result.containerCount = (await this.listContainers(name)).length;
      } catch {
        /* observation only */
      }
      try {
        result.health = (await this.client.probeComposeAppHealth(name)).state;
      } catch {
        /* observation only */
      }
      return result;
    } catch {
      return { reconciliation: "unknown" };
    }
  }

  /**
   * Continuation for a risky install. Only a caller that has independently
   * verified the SDK-signed request state and an accepted, schema-valid native
   * elicitation response may call this method. It does not accept a boolean
   * bypass. All safety rechecks and single-use consumption run under the same
   * process-wide lock as benign installation.
   */
  async installApprovedCompose(
    source: string,
    permissions: PermissionLayer,
    verifiedState: PendingInstallPayload,
    target: string,
    principal: string,
    ledger: ChallengeLedger,
  ): Promise<Exclude<InstallSafeResult, { status: "confirmation_required" }>> {
    return runInstallExclusive(async () => {
      permissions.assertCanInstall("install");
      const state = parsePendingInstallPayload(verifiedState);
      if (state.contentSha256 !== sourceFingerprint(source)) {
        throw new AppError(
          "INPUT_INVALID",
          "The compose document does not match the approved install.",
        );
      }

      // Fresh host list, local parse/risk analysis and upstream dry-run/ports.
      const preflight = await preflightInstall(
        source,
        this,
        permissions,
        assertInstallNameAvailable,
      );
      if (
        preflight.status !== "confirmation_required" ||
        preflight.findings.length === 0
      ) {
        throw new AppError(
          "INPUT_INVALID",
          "The approved risk disclosure is no longer applicable.",
        );
      }
      assertPendingInstallIntentsMatch(state, {
        source,
        name: preflight.name,
        findings: preflight.findings,
        target,
      });

      // No await between consumption and the mutation boundary. Failure to
      // reserve at capacity burns this approval without attempting a POST.
      ledger.consume(state.challengeId, {
        tool: state.tool,
        contentFingerprint: state.contentSha256,
        principal,
      });
      return this.attemptInstallOnce(source, preflight.name);
    });
  }

  /** Called only inside the install lock, after all applicable checks. */
  private async attemptInstallOnce(
    source: string,
    name: string,
    nativeAppId?: string,
  ): Promise<Exclude<InstallSafeResult, { status: "confirmation_required" }>> {
    if (nativeAppId !== undefined) {
      if (reservedNativeAppIds.has(nativeAppId)) {
        throw new AppError(
          "ZIMAOS_BAD_REQUEST",
          "An install for this catalog identity was already attempted.",
        );
      }
      if (reservedNativeAppIds.size >= MAX_RESERVED_INSTALL_NAMES) {
        throw new AppError("INTERNAL", "Catalog install reservations are exhausted.");
      }
    }
    reserveInstallName(name);
    if (nativeAppId !== undefined) reservedNativeAppIds.add(nativeAppId);
    const install =
      nativeAppId === undefined
        ? await this.client.installComposeOnce(source)
        : await this.client.installNativeStoreComposeOnce(source);
    if (install.status === "rejected") {
      // Definitive rejection only: an accepted or ambiguous attempt may land.
      releaseInstallName(name);
      if (nativeAppId !== undefined) reservedNativeAppIds.delete(nativeAppId);
    }
    return { status: install.status, accepted: install.accepted };
  }
}
