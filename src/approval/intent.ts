/**
 * Deterministic install-intent digests for pending install approvals
 * (Phase 2D slice).
 *
 * Pure data: no state minting/consumption, no challenges, no SDK/MCP wiring,
 * no services, no HTTP, no mutation. It computes the exact digest fields that
 * a pending-install request-state payload binds to, and compares them against
 * the values supplied at re-entry time so a client cannot echo back anything
 * other than what was approved:
 *
 * - `contentSha256` — SHA-256 of the EXACT original UTF-8 bytes of the compose
 *   source (no normalization, no trimming); any byte change changes it.
 * - `intendedAppName` — the exact supplied name (never derived from content).
 * - `targetDigest` — SHA-256 of the deployment target identity; the raw target
 *   value (e.g. host URL) is digested here and never returned or stored in
 *   readable state.
 * - `optionsDigest` — a module constant: SHA-256 of the canonical fixed options
 *   of the ONE real install POST (`dry_run=false&check_port_conflict=true`).
 *   It can only ever equal that value; there is no dry-run variant here.
 * - `riskDisclosureDigest` — SHA-256 over a normalized, key-sorted JSON form
 *   of exactly the supplied structured findings plus the fixed policy version.
 *
 * Every rejection throws AppError INPUT_INVALID with one of five fixed
 * sanitized messages that reflect no input content (no source echo).
 */

import { createHash } from "node:crypto";
import type { RiskFinding } from "../compose/analyze.js";
import { AppError } from "../errors.js";
import type { PendingInstallPayload } from "./requestState.js";
import { assertStoreSelection, type StoreSelection } from "../zimaos/storeCatalog.js";

/** Fixed policy version bound into every risk-disclosure digest (currently 1). */
export const RISK_POLICY_VERSION = "1";

/** Canonical fixed options of the single real install POST (never a dry run). */
const REAL_INSTALL_OPTIONS_QUERY = "dry_run=false&check_port_conflict=true";

/** Canonical request line whose SHA-256 is the bound `optionsDigest`. */
const REAL_INSTALL_REQUEST_LINE = `POST /v2/app_management/compose?${REAL_INSTALL_OPTIONS_QUERY}`;

/** Fixed sanitized rejections: each reflects no input content (no oracle). */
const CONTENT_CHANGED_MESSAGE =
  "The compose document does not match the approved install.";
const NAME_CHANGED_MESSAGE = "The application name does not match the approved install.";
const TARGET_CHANGED_MESSAGE =
  "The deployment target does not match the approved install.";
const OPTIONS_CHANGED_MESSAGE = "The install options do not match the approved install.";
const RISK_DISCLOSURE_CHANGED_MESSAGE =
  "The risk disclosure does not match the approved install.";

/** Fixed sanitized rejection: a supplied finding is not a structured finding. */
const INVALID_FINDINGS_MESSAGE = "The supplied risk findings are invalid.";

/** SHA-256 of the exact UTF-8 bytes of `input`, lowercase hex (64 chars). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Fingerprint of the EXACT original compose source: SHA-256 over its exact
 * UTF-8 bytes. Whitespace, line endings, and Unicode normalization form all
 * matter — this is a byte fingerprint, not a normalized one.
 */
export function sourceFingerprint(source: string): string {
  return sha256Hex(source);
}

/**
 * Identity digest of the deployment target (e.g. its host URL). Only the
 * digest may enter readable state; this module never returns or stores the
 * raw target value.
 */
export function targetIdentityDigest(target: string): string {
  return sha256Hex(target);
}

/**
 * The fixed `optionsDigest` bound at issuance: SHA-256 of the canonical real
 * install request line (`dry_run=false&check_port_conflict=true`). Computed
 * once; it is a constant and can never equal any dry-run variant.
 */
export const INSTALL_OPTIONS_DIGEST = sha256Hex(REAL_INSTALL_REQUEST_LINE);
export const STORE_INSTALL_OPTIONS_DIGEST = sha256Hex(
  `${REAL_INSTALL_REQUEST_LINE}&uncontrolled=false`,
);

/** Canonical key-sorted projection of one finding (fixed structure). */
function canonicalFinding(finding: RiskFinding): Record<string, string> {
  return {
    category: finding.category,
    description: finding.description,
    field: finding.field,
    service: finding.service,
  };
}

/** True when `value` is a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate that each supplied finding carries the four fixed string fields.
 * Extra keys are ignored (normalization projects onto the fixed structure).
 * Throws AppError INPUT_INVALID with a fixed message; never echoes content.
 */
function assertFindingsWellFormed(findings: RiskFinding[]): void {
  for (const finding of findings) {
    if (!isRecord(finding)) {
      throw new AppError("INPUT_INVALID", INVALID_FINDINGS_MESSAGE);
    }
    const fields = ["category", "description", "field", "service"] as const;
    for (const key of fields) {
      if (typeof finding[key] !== "string") {
        throw new AppError("INPUT_INVALID", INVALID_FINDINGS_MESSAGE);
      }
    }
  }
}

/**
 * Deterministic digest of the risk disclosure: SHA-256 over a normalized JSON
 * document containing exactly the supplied findings (in supplied order, each
 * projected to its four fixed fields with sorted keys) and the policy version.
 */
export function riskDisclosureDigest(
  findings: RiskFinding[],
  policyVersion: string = RISK_POLICY_VERSION,
): string {
  assertFindingsWellFormed(findings);
  const document = JSON.stringify({
    findings: findings.map(canonicalFinding),
    policyVersion,
  });
  return sha256Hex(document);
}

/**
 * The exact pending-install payload fields bound at issuance. Field names and
 * types match `PendingInstallPayload` one-to-one so the result can be spread
 * into a payload without transformation.
 */
export interface PendingInstallIntents {
  /** SHA-256 of the exact original source bytes. */
  contentSha256: string;
  /** The exact supplied application name (verbatim). */
  intendedAppName: string;
  /** SHA-256 of the deployment target identity (no raw URL in state). */
  targetDigest: string;
  /** Always `INSTALL_OPTIONS_DIGEST` (the fixed real-POST options). */
  optionsDigest: string;
  /** SHA-256 over normalized findings + policy version. */
  riskDisclosureDigest: string;
}

/** The exact values the digests are computed from at issuance. */
export interface PendingInstallIntentInput {
  /** Exact original compose source (UTF-8 string, byte-exact). */
  source: string;
  /** Intended safe application name shown to the user. */
  name: string;
  /** Exactly the structured findings disclosed for confirmation. */
  findings: RiskFinding[];
  /** Deployment target identity (e.g. host URL); digested, never stored raw. */
  target: string;
}

/**
 * Construct the pending-install payload fields from exactly the supplied
 * source/name/findings/target. Pure data: no state is minted or consumed and
 * nothing here performs I/O. Throws AppError INPUT_INVALID (fixed message)
 * when `name` is empty or a finding is malformed — never echoing content.
 */
export function buildPendingInstallIntents(
  input: PendingInstallIntentInput,
): PendingInstallIntents {
  if (typeof input.name !== "string" || input.name.length === 0) {
    throw new AppError("INPUT_INVALID", NAME_CHANGED_MESSAGE);
  }
  assertFindingsWellFormed(input.findings);
  return {
    contentSha256: sourceFingerprint(input.source),
    intendedAppName: input.name,
    targetDigest: targetIdentityDigest(input.target),
    optionsDigest: INSTALL_OPTIONS_DIGEST,
    riskDisclosureDigest: riskDisclosureDigest(input.findings, RISK_POLICY_VERSION),
  };
}

/**
 * Compare the bound pending-install payload fields against exactly the values
 * supplied at re-entry time. Recomputes every digest from the supplied
 * source/name/findings/target and requires each field to match; on any change
 * (content bytes, name, target identity, options, or findings/policy) throws
 * AppError INPUT_INVALID with one of five fixed sanitized messages that
 * reflect no input content.
 */
export function assertPendingInstallIntentsMatch(
  bound: Pick<
    PendingInstallPayload,
    | "contentSha256"
    | "intendedAppName"
    | "targetDigest"
    | "optionsDigest"
    | "riskDisclosureDigest"
  >,
  supplied: PendingInstallIntentInput,
): void {
  assertInstallIntentsMatch(bound, supplied, INSTALL_OPTIONS_DIGEST);
}

function assertInstallIntentsMatch(
  bound: PendingInstallIntents,
  supplied: PendingInstallIntentInput,
  expectedOptionsDigest: string,
): void {
  if (typeof supplied.name !== "string" || supplied.name.length === 0) {
    throw new AppError("INPUT_INVALID", NAME_CHANGED_MESSAGE);
  }
  assertFindingsWellFormed(supplied.findings);

  if (bound.contentSha256 !== sourceFingerprint(supplied.source)) {
    throw new AppError("INPUT_INVALID", CONTENT_CHANGED_MESSAGE);
  }
  if (bound.intendedAppName !== supplied.name) {
    throw new AppError("INPUT_INVALID", NAME_CHANGED_MESSAGE);
  }
  if (bound.targetDigest !== targetIdentityDigest(supplied.target)) {
    throw new AppError("INPUT_INVALID", TARGET_CHANGED_MESSAGE);
  }
  if (bound.optionsDigest !== expectedOptionsDigest) {
    throw new AppError("INPUT_INVALID", OPTIONS_CHANGED_MESSAGE);
  }
  if (
    bound.riskDisclosureDigest !==
    riskDisclosureDigest(supplied.findings, RISK_POLICY_VERSION)
  ) {
    throw new AppError("INPUT_INVALID", RISK_DISCLOSURE_CHANGED_MESSAGE);
  }
}

export interface StoreInstallIntentInput extends PendingInstallIntentInput {
  selection: StoreSelection;
}

export interface StoreInstallIntents extends PendingInstallIntents {
  selectionDigest: string;
}

function storeSelectionDigest(selection: StoreSelection): string {
  assertStoreSelection(selection);
  return sha256Hex(JSON.stringify([selection.repoId, selection.appId]));
}

/** Final associated bytes and the exact current native selection/controlled request. */
export function buildStoreInstallIntents(
  input: StoreInstallIntentInput,
): StoreInstallIntents {
  return {
    ...buildPendingInstallIntents(input),
    optionsDigest: STORE_INSTALL_OPTIONS_DIGEST,
    selectionDigest: storeSelectionDigest(input.selection),
  };
}

export function assertStoreInstallIntentsMatch(
  bound: StoreInstallIntents,
  supplied: StoreInstallIntentInput,
): void {
  assertInstallIntentsMatch(bound, supplied, STORE_INSTALL_OPTIONS_DIGEST);
  if (bound.selectionDigest !== storeSelectionDigest(supplied.selection)) {
    throw new AppError(
      "INPUT_INVALID",
      "The store selection does not match the approved install.",
    );
  }
}
