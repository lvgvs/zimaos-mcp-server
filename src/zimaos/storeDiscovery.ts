/**
 * Pure store discovery normalization and search-input validation.
 *
 * This module is intentionally free of network, transport, services, and
 * MCP wiring. It only:
 *
 * - normalizes one upstream store item into a bounded snake_case allowlist
 *   summary (or detail) with fixed sanitized errors;
 * - validates a strict `{ query, limit }` search input.
 *
 * Upstream payload content is never reflected in error messages.
 */

import { AppError, isRecord } from "../errors.js";
import { assertStoreSelection } from "./storeCatalog.js";
import type { StoreSelection } from "./storeCatalog.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Bounded store discovery summary (allowlist fields only). */
export interface StoreDiscoveryItem {
  repo_id: string;
  app_id: string;
  name?: string;
  version?: string;
  tagline?: string;
  category?: string;
  architectures?: string[];
}

/** Store discovery detail: the summary plus optional detail fields. */
export interface StoreDiscoveryDetail extends StoreDiscoveryItem {
  description?: string;
  author?: string;
  developer?: string;
  release_notes?: string;
}

/** Validated store search input. */
export interface StoreSearchInput {
  readonly query: string;
  readonly limit: number;
}

// ---------------------------------------------------------------------------
// Fixed, sanitized messages (no input reflection)
// ---------------------------------------------------------------------------

const IDENTITY_INVALID = "The upstream store item identity could not be verified.";
const ITEM_MALFORMED = "The upstream store item is malformed; retry later.";
const TYPE_UNSUPPORTED = "The requested store item type is not supported.";
const SEARCH_INPUT_INVALID = "The store search input is invalid.";

const MAX_ARCHITECTURES = 8;
const MAX_ARCH_LABEL_LENGTH = 32;
const ARCH_LABEL = /^[a-z0-9_]+$/;

const MAX_NAME_LENGTH = 120;
const MAX_VERSION_LENGTH = 80;
const MAX_TAGLINE_LENGTH = 512;
const MAX_CATEGORY_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 12000;
const MAX_AUTHOR_LENGTH = 256;
const MAX_DEVELOPER_LENGTH = 256;
const MAX_RELEASE_NOTES_LENGTH = 8000;

const MAX_QUERY_LENGTH = 256;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// normalizeStoreDiscoveryItem
// ---------------------------------------------------------------------------

/** Fixed upstream error. */
function failUpstream(message: string): never {
  throw new AppError("ZIMAOS_UPSTREAM_ERROR", message);
}

/**
 * Read an optional bounded string display field.
 *
 * - absent/null/empty string -> undefined (omitted from the result);
 * - wrong type or oversized -> fixed upstream error.
 */
function boundedString(
  data: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = data[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) {
    failUpstream(ITEM_MALFORMED);
  }
  return value;
}

/**
 * Read the optional `architectures` field.
 *
 * - absent/null -> undefined (omitted);
 * - must be an array of <= 8 unique, nonempty labels matching
 *   /^[a-z0-9_]+$/ with length <= 32;
 * - output sorted bytewise.
 */
function boundedArchitectures(data: Record<string, unknown>): string[] | undefined {
  const value = data.architectures;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARCHITECTURES) {
    failUpstream(ITEM_MALFORMED);
  }
  const seen = new Set<string>();
  for (const label of value) {
    if (
      typeof label !== "string" ||
      label.length === 0 ||
      label.length > MAX_ARCH_LABEL_LENGTH ||
      !ARCH_LABEL.test(label)
    ) {
      failUpstream(ITEM_MALFORMED);
    }
    if (seen.has(label)) failUpstream(ITEM_MALFORMED);
    seen.add(label);
  }
  return [...value].sort();
}

/**
 * Normalize one upstream store item into a bounded allowlist result.
 *
 * - when `expected` is provided, the upstream item must be a record whose
 *   `id`/`repo_id` exactly equal the requested canonical pair, otherwise a
 *   fixed `ZIMAOS_UPSTREAM_ERROR` is thrown (values never reflected);
 * - when `expected` is absent, `id`/`repo_id` must still be present
 *   non-empty strings to identify the item;
 * - `type` must be explicitly present and exactly `"compose"`, otherwise a
 *   sanitized `ZIMAOS_BAD_REQUEST`;
 * - only allowlist display fields are emitted; everything else
 *   (source/envs/ports/volumes/URLs/config/installed/update metadata) is
 *   dropped.
 */
export function normalizeStoreDiscoveryItem(
  data: unknown,
  expected: StoreSelection | undefined,
  details: true,
): StoreDiscoveryDetail;
export function normalizeStoreDiscoveryItem(
  data: unknown,
  expected?: StoreSelection,
  details?: false,
): StoreDiscoveryItem;
export function normalizeStoreDiscoveryItem(
  data: unknown,
  expected?: StoreSelection,
  details: boolean = false,
): StoreDiscoveryItem | StoreDiscoveryDetail {
  if (!isRecord(data)) {
    failUpstream(IDENTITY_INVALID);
  }

  if (expected !== undefined) {
    assertStoreSelection(expected);
    if (data.id !== expected.appId || data.repo_id !== expected.repoId) {
      failUpstream(IDENTITY_INVALID);
    }
  } else {
    try {
      assertStoreSelection({ repoId: data.repo_id, appId: data.id });
    } catch {
      failUpstream(IDENTITY_INVALID);
    }
  }

  if (data.type === undefined) failUpstream(ITEM_MALFORMED);
  if (data.type !== "compose") {
    throw new AppError("ZIMAOS_BAD_REQUEST", TYPE_UNSUPPORTED);
  }

  const result: StoreDiscoveryItem = {
    repo_id: data.repo_id as string,
    app_id: data.id as string,
  };

  const name = boundedString(data, "title", MAX_NAME_LENGTH);
  if (name !== undefined) result.name = name;
  const version = boundedString(data, "version", MAX_VERSION_LENGTH);
  if (version !== undefined) result.version = version;
  const tagline = boundedString(data, "tagline", MAX_TAGLINE_LENGTH);
  if (tagline !== undefined) result.tagline = tagline;
  const category = boundedString(data, "category", MAX_CATEGORY_LENGTH);
  if (category !== undefined) result.category = category;

  const architectures = boundedArchitectures(data);
  if (architectures !== undefined) result.architectures = architectures;

  if (details) {
    const detail = result as StoreDiscoveryDetail;
    const description = boundedString(data, "description", MAX_DESCRIPTION_LENGTH);
    if (description !== undefined) detail.description = description;
    const author = boundedString(data, "author", MAX_AUTHOR_LENGTH);
    if (author !== undefined) detail.author = author;
    const developer = boundedString(data, "developer", MAX_DEVELOPER_LENGTH);
    if (developer !== undefined) detail.developer = developer;
    const releaseNotes = boundedString(data, "release_note", MAX_RELEASE_NOTES_LENGTH);
    if (releaseNotes !== undefined) detail.release_notes = releaseNotes;
  }

  return result;
}

// ---------------------------------------------------------------------------
// validateStoreSearchInput
// ---------------------------------------------------------------------------

/** True when the code point is a control character (U+0000..U+001F or DEL). */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true;
  }
  return false;
}

/**
 * Validate a strict store search input: a record with only `query` and
 * `limit`.
 *
 * - `query`: required string, trimmed to nonempty, bounded to 256 code
 *   units in the original input, no control characters; literal text only
 *   (never interpreted as a URL);
 * - `limit`: optional integer in 1..50, defaulting to 20.
 *
 * All failures are a sanitized `INPUT_INVALID` with a fixed message.
 */
export function validateStoreSearchInput(input: unknown): StoreSearchInput {
  if (!isRecord(input)) {
    throw new AppError("INPUT_INVALID", SEARCH_INPUT_INVALID);
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "query" && key !== "limit") || !keys.includes("query")) {
    throw new AppError("INPUT_INVALID", SEARCH_INPUT_INVALID);
  }

  const rawQuery = input.query;
  if (
    typeof rawQuery !== "string" ||
    rawQuery.length === 0 ||
    rawQuery.length > MAX_QUERY_LENGTH ||
    hasControlChars(rawQuery)
  ) {
    throw new AppError("INPUT_INVALID", SEARCH_INPUT_INVALID);
  }
  const query = rawQuery.trim();
  if (query.length === 0) {
    throw new AppError("INPUT_INVALID", SEARCH_INPUT_INVALID);
  }

  const limit = input.limit;
  if (limit === undefined) {
    return { query, limit: DEFAULT_LIMIT };
  }
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < MIN_LIMIT ||
    limit > MAX_LIMIT
  ) {
    throw new AppError("INPUT_INVALID", SEARCH_INPUT_INVALID);
  }
  return { query, limit };
}
