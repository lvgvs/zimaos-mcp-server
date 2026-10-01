import { AppError } from "../errors.js";
import { parseCompose, type ParseComposeResult } from "../compose/parse.js";
import { compareComposeRisk } from "../compose/riskDelta.js";
import { sourceFingerprint } from "../approval/intent.js";
import type { ZimaOsClient } from "./client.js";

const SAFE_APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

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
}
