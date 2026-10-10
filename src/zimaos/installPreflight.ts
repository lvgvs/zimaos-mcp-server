/**
 * Non-mutating install preflight (Phase 2C).
 *
 * `preflightInstall` decides whether an explicit compose document is ready to
 * be installed, or requires user confirmation because of local risk findings —
 * without installing anything. It composes the existing pieces:
 *
 *   PermissionLayer.assertCanInstall -> parseCompose (exact name) ->
 *   AppService.listApps (one read) + assertInstallIdentity ->
 *   AppService.validateCompose (one dry run, no install).
 *
 * Fail-closed rules:
 * - the permission check runs first; with installs disabled by default there is
 *   zero upstream traffic;
 * - a local parse failure becomes a fixed normalized AppError and never echoes
 *   raw YAML;
 * - a non-accepted dry-run outcome (rejected, or an ambiguous upstream_error
 *   such as HTTP 502) fails closed with a fixed normalized AppError — an
 *   ambiguous outcome is NOT classified as invalid input;
 * - any reported host port conflict fails closed.
 *
 * Nothing here mutates: no install POST, no MCP surface, no other services.
 */

import { AppError } from "../errors.js";
import type { RiskFinding } from "../compose/analyze.js";
import { parseCompose } from "../compose/parse.js";
import { assertInstallIdentity } from "./installIdentity.js";
import type { AppService } from "./appService.js";
import type { PermissionLayer } from "../permissions.js";

/** Fixed sanitized message: the document could not be parsed locally. */
const PARSE_FAILED_MESSAGE =
  "The compose document could not be parsed for install preflight.";

/** Fixed sanitized message: host ports required by the document are in use. */
const PORTS_IN_USE_MESSAGE =
  "One or more host ports required by this compose document are already in use on the ZimaOS host.";

/** Fixed sanitized message: the host definitively rejected the dry run. */
const REJECTED_MESSAGE =
  "The ZimaOS host rejected this compose document during dry-run validation.";

/**
 * Fixed sanitized message for an ambiguous upstream failure (e.g. HTTP 502).
 * Deliberately does not claim the document is invalid: the outcome is unknown,
 * so preflight fails closed instead of proceeding.
 */
const UPSTREAM_ERROR_MESSAGE =
  "Compose dry-run validation could not be completed; install preflight failed safely.";

/** Result of a non-mutating install preflight. */
export interface InstallPreflightResult {
  /**
   * - "ready": accepted in dry run, no port conflicts, no risk findings.
   * - "confirmation_required": accepted and conflict-free, but local risk
   *   findings require explicit user confirmation before any install.
   */
  status: "ready" | "confirmation_required";
  /** The exact top-level compose name from the document (verbatim). */
  name: string;
  /** Local analyzer findings (empty for a ready result). */
  findings: RiskFinding[];
}

/**
 * Run the non-mutating install preflight for one compose source.
 *
 * Returns `ready` or `confirmation_required`; throws a normalized AppError to
 * fail closed on disabled permission, unparseable input, an unsafe/duplicate
 * identity, a rejected dry run, an ambiguous upstream failure, or host port
 * conflicts. Never installs and never echoes raw YAML in errors.
 */
export async function preflightInstall(
  source: string,
  apps: Pick<AppService, "listApps" | "validateCompose">,
  permissions: PermissionLayer,
  assertAvailable?: (name: string) => void,
  assertAssociationAvailable?: (
    apps: Awaited<ReturnType<AppService["listApps"]>>,
  ) => Promise<void>,
): Promise<InstallPreflightResult> {
  // Permission first: with the default-off policy this throws before any
  // upstream traffic (zero list reads, zero dry runs).
  permissions.assertCanInstall("install");

  // Local parse for the exact name string; local failures never echo YAML.
  let parsedName: string | undefined;
  try {
    const parsed = parseCompose(source);
    parsedName = parsed.name;
  } catch {
    throw new AppError("INPUT_INVALID", PARSE_FAILED_MESSAGE);
  }

  // One list read, used for the identity/duplicate assertion.
  const existingApps = await apps.listApps();
  const name = assertInstallIdentity(parsedName, existingApps);
  // The install service may also check its process-local reservation after
  // the fresh host list read and before any upstream dry run.
  assertAvailable?.(name);
  // Await supported association reads before dry-run or later mutation.
  await assertAssociationAvailable?.(existingApps);

  // Exactly one dry run (inside validateCompose): parse + analyze + dry-run.
  const validation = await apps.validateCompose(source);

  // Fail closed on port conflicts before anything else: a conflict means the
  // document cannot be installed as-is regardless of other outcomes.
  if ((validation.portsInUse ?? []).length > 0) {
    throw new AppError("ZIMAOS_BAD_REQUEST", PORTS_IN_USE_MESSAGE);
  }

  // A definitive host rejection fails closed (the host said no).
  if (validation.status === "rejected") {
    throw new AppError("ZIMAOS_BAD_REQUEST", REJECTED_MESSAGE);
  }

  // An ambiguous upstream failure (e.g. HTTP 502) is NOT invalid input: fail
  // closed with the upstream code so callers can distinguish it.
  if (validation.status !== "accepted") {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE);
  }

  // Accepted, conflict-free: findings decide whether confirmation is needed.
  return validation.findings.length > 0
    ? { status: "confirmation_required", name, findings: validation.findings }
    : { status: "ready", name, findings: [] };
}
