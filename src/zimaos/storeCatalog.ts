/**
 * Pure store catalog normalization, selection validation, and compose
 * association (Phase 6 slice).
 *
 * This module is intentionally free of network, services, and tool wiring.
 * It only:
 *
 * - normalizes the unwrapped `/v3/app_store/repo` listing payload into
 *   enabled `v2`/`http` repositories;
 * - validates a caller `StoreSelection` (repository id + canonical
 *   lower-case reverse-domain app id);
 * - normalizes a store detail payload into the single compose path the
 *   server itself selected for the caller's architecture;
 * - associates a fetched store compose document with its repository via a
 *   minimal, verified AST edit (`x-casaos.repo_id`).
 *
 * All failures are fixed-code `AppError`s with sanitized messages; upstream
 * payload content, YAML source, URLs, and stack traces are never reflected.
 */

import { parseDocument, isAlias, isMap, isScalar, Pair, Scalar } from "yaml";
import type { Document } from "yaml";

import { AppError, isRecord } from "../errors.js";
import { parseCompose } from "../compose/parse.js";
import type { ParseComposeResult } from "../compose/parse.js";
import { assertInstallIdentity } from "./installIdentity.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A caller-selected store item: repository + canonical app id. */
export interface StoreSelection {
  readonly repoId: string;
  readonly appId: string;
}

/** Normalized, enabled store repository (v2, http transport). */
export interface StoreRepository {
  readonly id: string;
}

/** Normalized store detail for one architecture. */
export interface StoreDetail {
  repoId: string;
  appId: string;
  /** Optional display title (string, <= 120 chars). */
  name?: string;
  /** Optional version string (<= 80 chars). */
  version?: string;
  /** The caller's current architecture (amd64/arm64). */
  architecture: string;
  /** Exact compose file path served by the store for this architecture. */
  composePath: string;
}

/** Result of associating a compose document with its store repository. */
export interface AssociatedCompose {
  /** Authoritative final source; downstream steps must use this. */
  readonly source: string;
  /** The verified top-level compose name. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Fixed, sanitized messages (no input reflection)
// ---------------------------------------------------------------------------

const REPOSITORIES_INVALID = "Store repository listing is malformed; retry later.";
const SELECTION_INVALID =
  "The store selection is invalid: the repository id must be a safe identifier.";
const APP_ID_INVALID =
  "The app id must be a lower-case reverse-domain identifier with at least two non-empty segments.";
const BAD_REQUEST_MESSAGE = "The requested store item is not supported.";
const DETAIL_MISMATCH =
  "Store detail does not match the requested selection or architecture; retry later.";

// ---------------------------------------------------------------------------
// Shared identifier rules
// ---------------------------------------------------------------------------

/** Starts with an ASCII letter/digit; then ASCII letters, digits, '.', '_', '@', '-'; max 128 chars. */
const SAFE_ID_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

function isSafeRepositoryId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) {
    return false;
  }
  if (!SAFE_ID_PREFIX.test(id)) return false;
  // No consecutive dots, no trailing dot or '@', and at most one '@':
  // these rules make duplicate/ambiguous ids fail closed.
  if (id.includes("..")) return false;
  if (id.endsWith(".") || id.endsWith("@")) return false;
  let at = 0;
  for (const ch of id) {
    if (ch === "@") at += 1;
  }
  return at <= 1;
}

/** Canonical lower-case reverse-domain app id: >= 2 non-empty dot segments, charset a-z0-9 . _ -, max 192 chars. */
function isCanonicalAppId(appId: unknown): appId is string {
  if (typeof appId !== "string" || appId.length === 0 || appId.length > 192) {
    return false;
  }
  if (!/^[a-z0-9._-]+$/.test(appId)) return false;
  const segments = appId.split(".");
  if (segments.length < 2) return false;
  return segments.every((segment) => segment.length > 0);
}

/** Current architecture we can consume. */
const SUPPORTED_ARCHITECTURES = new Set(["amd64", "arm64"]);

const MAX_REPOSITORIES = 128;
const MAX_ARCHITECTURES = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_VERSION_LENGTH = 80;

// ---------------------------------------------------------------------------
// normalizeStoreRepositories
// ---------------------------------------------------------------------------

/**
 * Normalize the unwrapped array payload returned by `/v3/app_store/repo`.
 *
 * - only entries that are enabled, `version: "v2"`, `transport: "http"` are
 *   returned, as `{ id }`;
 * - disabled/v1/zip/other-transport entries are ignored;
 * - every entry (including ignored ones) must be a record with a unique
 *   safe repository id, otherwise the whole listing fails closed.
 *
 * Fails with `AppError ZIMAOS_UPSTREAM_ERROR` (fixed message).
 */
export function normalizeStoreRepositories(data: unknown): StoreRepository[] {
  if (!Array.isArray(data) || data.length > MAX_REPOSITORIES) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", REPOSITORIES_INVALID);
  }

  const seen = new Set<string>();
  const repos: StoreRepository[] = [];
  for (const entry of data) {
    if (!isRecord(entry) || !isSafeRepositoryId(entry.id)) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", REPOSITORIES_INVALID);
    }
    const key = entry.id.toLowerCase();
    if (seen.has(key)) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", REPOSITORIES_INVALID);
    }
    seen.add(key);
    if (entry.enabled === true && entry.version === "v2" && entry.transport === "http") {
      repos.push({ id: entry.id });
    }
  }
  return repos;
}

// ---------------------------------------------------------------------------
// assertStoreSelection
// ---------------------------------------------------------------------------

/**
 * Validate a caller selection. Throws `AppError INPUT_INVALID` with a fixed
 * message; never echoes input content.
 */
export function assertStoreSelection(selection: unknown): void {
  if (!isRecord(selection)) {
    throw new AppError("INPUT_INVALID", SELECTION_INVALID);
  }
  if (Object.keys(selection).some((key) => key !== "repoId" && key !== "appId")) {
    throw new AppError("INPUT_INVALID", SELECTION_INVALID);
  }
  if (!isSafeRepositoryId(selection.repoId)) {
    throw new AppError("INPUT_INVALID", SELECTION_INVALID);
  }
  if (!isCanonicalAppId(selection.appId)) {
    throw new AppError("INPUT_INVALID", APP_ID_INVALID);
  }
}

// ---------------------------------------------------------------------------
// normalizeStoreDetail
// ---------------------------------------------------------------------------

/**
 * Normalize a store detail payload for the caller's current architecture.
 *
 * The caller's architecture must be one we support and must be advertised by
 * the detail. The server-selected `source.compose_arch` must exactly equal
 * the caller's architecture (no universal/default fallback, no guessing).
 * The compose path must be exactly the canonical store path and must match
 * `source.compose_architectures[architecture].path`; only paths are used,
 * remote URLs are rejected.
 *
 * Unsupported type/architecture -> `ZIMAOS_BAD_REQUEST`;
 * malformed or mismatched fields -> `ZIMAOS_UPSTREAM_ERROR`.
 */
export function normalizeStoreDetail(
  data: unknown,
  selection: StoreSelection,
  architecture: string,
): StoreDetail {
  assertStoreSelection(selection);

  if (!isRecord(data)) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }
  if (data.id !== selection.appId || data.repo_id !== selection.repoId) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }
  if (data.type !== "compose") {
    throw new AppError("ZIMAOS_BAD_REQUEST", BAD_REQUEST_MESSAGE);
  }

  const architectures = data.architectures;
  if (!Array.isArray(architectures)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", BAD_REQUEST_MESSAGE);
  }
  if (
    architectures.length > MAX_ARCHITECTURES ||
    !architectures.every((a) => typeof a === "string") ||
    new Set(architectures).size !== architectures.length
  ) {
    throw new AppError("ZIMAOS_BAD_REQUEST", BAD_REQUEST_MESSAGE);
  }

  if (typeof architecture !== "string" || !SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", BAD_REQUEST_MESSAGE);
  }
  if (!architectures.includes(architecture)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", BAD_REQUEST_MESSAGE);
  }

  const source = data.source;
  if (!isRecord(source)) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }
  if (source.compose_arch !== architecture) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }

  const canonicalPath = `/apps/${selection.appId}/docker-compose.${architecture}.yml`;
  if (source.compose_path !== canonicalPath) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }

  const perArch = source.compose_architectures;
  if (!isRecord(perArch)) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }
  const archEntry = perArch[architecture];
  if (!isRecord(archEntry) || archEntry.path !== canonicalPath) {
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
  }

  const result: StoreDetail = {
    repoId: selection.repoId,
    appId: selection.appId,
    architecture,
    composePath: canonicalPath,
  };
  const title = data.title;
  if (title !== undefined) {
    if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
    }
    result.name = title;
  }
  const version = data.version;
  if (version !== undefined) {
    if (typeof version !== "string" || version.length > MAX_VERSION_LENGTH) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", DETAIL_MISMATCH);
    }
    result.version = version;
  }
  return result;
}

// ---------------------------------------------------------------------------
// associateStoreCompose
// ---------------------------------------------------------------------------

function parseBoundedAst(source: string): Document {
  // Same parser configuration as parseCompose: core YAML 1.2, merge-aware,
  // strict, unique keys.
  const doc = parseDocument(source, {
    version: "1.2",
    schema: "core",
    merge: true,
    strict: true,
    uniqueKeys: true,
    resolveKnownTags: false,
    prettyErrors: false,
  });
  if (doc.errors.length > 0 || doc.warnings.length > 0) {
    throw new Error("unparseable");
  }
  return doc;
}

/** Bounded parse; wrap any failure as a fixed upstream error. */
function parseOrUpstream(source: string): ParseComposeResult {
  try {
    return parseCompose(source);
  } catch {
    failUpstream(DETAIL_MISMATCH);
  }
}

/** Bounded AST parse; wrap any failure as a fixed upstream error. */
function parseAstOrUpstream(source: string): Document {
  try {
    return parseBoundedAst(source);
  } catch {
    failUpstream(DETAIL_MISMATCH);
  }
}

/** Fixed upstream error. */
function failUpstream(reason: string): never {
  throw new AppError("ZIMAOS_UPSTREAM_ERROR", reason);
}

/**
 * Associate a fetched store compose document with its repository.
 *
 * Steps:
 * 1. `parseCompose` first (bounded parse; failures wrapped as
 *    `ZIMAOS_UPSTREAM_ERROR` with no raw YAML echoed).
 * 2. Require an explicit safe top-level `name` via `assertInstallIdentity`.
 * 3. Require a plain top-level `x-casaos` mapping (aliased or merge-built
 *    nodes are rejected fail-closed) whose `id` scalar string equals
 *    `selection.appId`.
 * 4. `x-casaos.repo_id`:
 *    - absent          -> add it as the single deterministic AST field
 *                         (`doc.toString()` output is authoritative);
 *    - present + same  -> preserve the original source bytes exactly;
 *    - present + different/non-string -> fail `ZIMAOS_UPSTREAM_ERROR`.
 * 5. Reparse the final source and verify name/id/repo before returning.
 *
 * Nothing else in the document is stripped or rewritten.
 */
export function associateStoreCompose(
  source: string,
  selection: StoreSelection,
): AssociatedCompose {
  assertStoreSelection(selection);
  // Bounded parse first (limits, warnings, sanitized failures).
  const parsed = parseOrUpstream(source);
  const name = assertInstallIdentity(parsed.name, []);

  const doc = parseAstOrUpstream(source);

  const casaos = doc.get("x-casaos");
  if (!isMap(casaos) || casaos.anchor) failUpstream(DETAIL_MISMATCH);

  // Fail closed on unsafe AST shapes: aliased keys/values or merge keys.
  for (const pair of casaos.items) {
    if (isAlias(pair.key) || isAlias(pair.value)) {
      failUpstream(DETAIL_MISMATCH);
    }
    if (isScalar(pair.key) && pair.key.value === "<<") {
      failUpstream(DETAIL_MISMATCH);
    }
  }

  const idNode = casaos.get("id", true);
  if (!isScalar(idNode) || idNode.value !== selection.appId) {
    failUpstream(DETAIL_MISMATCH);
  }

  const repoNode = casaos.get("repo_id", true);
  let finalSource: string;
  if (repoNode === undefined) {
    casaos.items.push(new Pair(new Scalar("repo_id"), new Scalar(selection.repoId)));
    finalSource = doc.toString();
  } else {
    if (!isScalar(repoNode) || repoNode.value !== selection.repoId) {
      failUpstream(DETAIL_MISMATCH);
    }
    // Already associated: preserve the exact source bytes.
    finalSource = source;
  }

  // Verify the authoritative final source reparses with the expected identity.
  const verified = parseOrUpstream(finalSource);
  if (verified.name !== name) failUpstream(DETAIL_MISMATCH);
  const verifiedCasaos = verified.document.get("x-casaos");
  if (
    !(verifiedCasaos instanceof Map) ||
    verifiedCasaos.get("id") !== selection.appId ||
    verifiedCasaos.get("repo_id") !== selection.repoId
  ) {
    failUpstream(DETAIL_MISMATCH);
  }

  return { source: finalSource, name };
}
