/**
 * Application domain service.
 *
 * Wraps the ZimaOS app-management client and returns normalized domain models.
 * All upstream failures are mapped to AppError with stable codes; raw payloads
 * never leak past this layer (AGENTS.md).
 */

import { AppError } from "../errors.js";
import type { HealthProbeResult, ZimaOsClient } from "./client.js";
import type { ComposeValidationResult } from "./client.js";
import { analyzeCompose, type RiskFinding } from "../compose/analyze.js";
import { parseCompose } from "../compose/parse.js";
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

  /** List all installed compose applications (normalized summaries). */
  async listApps(): Promise<AppInfo[]> {
    const data = await this.client.listComposeApps();
    return normalizeAppList(data);
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
  async validateCompose(source: string): Promise<ValidateComposeResult> {
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
    const validation = await this.client.validateCompose(source);
    return { ...validation, findings };
  }
}
