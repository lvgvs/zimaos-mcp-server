/**
 * Bounded read-only store discovery service (Phase 7 slice).
 *
 * Thin, typed orchestration over the existing pure normalizers and the
 * authenticated native client reads. No caching, fallback, version
 * selection, mutation, installed-state reads, or update detection happens
 * here; MCP wiring is added separately.
 *
 *   searchAppStore:
 *     1. strict `{ query, limit }` input validation -> INPUT_INVALID, 0 reads;
 *     2. fresh repository listing normalized to enabled v2/http ids;
 *        an empty trusted set returns `{ apps: [], truncated: false }` with
 *        exactly one listing read and no search traffic;
 *     3. up to five 60-row pages are fetched sequentially (the client
 *        allows pages 1..5) to collect the whole bounded relevance window;
 *        results are sorted bytewise and `truncated` reports omitted rows;
 *     4. every raw envelope is verified as an exact echo of the requested
 *        trimmed text, the exact trusted bytewise repository set, the fixed
 *        60-row page shape, and the derived pagination/status snapshot;
 *     5. every normalized row passes the no-I/O metadata guard.
 *
 *   getAppStoreDetails:
 *     1. strict selection validation -> INPUT_INVALID, 0 reads;
 *     2. the fresh repository listing must contain the exact requested
 *        enabled v2/http repository -> ZIMAOS_BAD_REQUEST otherwise;
 *     3. the exact detail is normalized and passes the no-I/O guard.
 *
 * All failures are fixed-code AppErrors; upstream payload content is never
 * reflected in error messages.
 */

import { AppError, isRecord } from "../errors.js";
import type { ZimaOsClient } from "./client.js";
import { assertStoreSelection, normalizeStoreRepositories } from "./storeCatalog.js";
import type { StoreSelection } from "./storeCatalog.js";
import {
  normalizeStoreDiscoveryItem,
  validateStoreSearchInput,
} from "./storeDiscovery.js";
import type { StoreDiscoveryDetail, StoreDiscoveryItem } from "./storeDiscovery.js";

/** The discovery service needs exactly these four readonly client reads. */
export type DiscoveryClient = Pick<
  ZimaOsClient,
  | "getStoreRepositories"
  | "getStoreSearchPage"
  | "getStoreAppDetail"
  | "assertStoreDiscoverySafe"
>;

/** Bounded, sorted, de-duplicated search result. */
export interface StoreSearchResult {
  readonly apps: readonly StoreDiscoveryItem[];
  /** True when more eligible results exist beyond the returned rows. */
  readonly truncated: boolean;
}

/** Fixed, sanitized message: the envelope is not an exact search echo. */
const ECHO_MISMATCH = "The store search envelope did not match the request.";

/** Fixed page shape of the native search transport. */
const PAGE_SIZE = 60;
/** The client bounds search reads to pages 1..5. */
const MAX_PAGES = 5;

function failEcho(): never {
  throw new AppError("ZIMAOS_UPSTREAM_ERROR", ECHO_MISMATCH);
}

/** True when an array is the exact unique string set, independent of order. */
function sameElements(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => typeof value === "string" && expected.includes(value))
  );
}

function bytewiseCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Verify one search envelope is an exact echo of the request and derive the
 * page snapshot. Throws the fixed echo mismatch on any deviation.
 */
function verifySearchEnvelope(
  envelope: unknown,
  page: number,
  query: string,
  trusted: readonly string[],
): {
  readonly rows: unknown[];
  readonly total: number;
  readonly totalPages: number;
} {
  if (!isRecord(envelope)) failEcho();

  if (envelope.success === false) failEcho();
  const successPresent = Object.prototype.hasOwnProperty.call(envelope, "success");
  if (successPresent && envelope.success !== true) failEcho();

  const rows = envelope.data;
  if (!Array.isArray(rows)) failEcho();
  // A full page is at most PAGE_SIZE rows; an empty page is always allowed.
  if (rows.length > PAGE_SIZE) failEcho();

  const pagination = envelope.pagination;
  if (!isRecord(pagination)) failEcho();
  const {
    page: pageEcho,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  } = pagination;
  if (pageEcho !== page || pageSize !== PAGE_SIZE) failEcho();
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) failEcho();
  if (
    typeof totalPages !== "number" ||
    !Number.isSafeInteger(totalPages) ||
    totalPages < 0
  )
    failEcho();
  if (total === 0) {
    if (page !== 1 || totalPages > 1) failEcho();
  } else if (totalPages !== Math.ceil(total / PAGE_SIZE) || page > totalPages) failEcho();

  const expectedCount =
    total > 0 ? Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE)) : 0;
  if (rows.length !== expectedCount) failEcho();

  const queryEcho = envelope.query;
  if (!isRecord(queryEcho)) failEcho();
  const types = Array.isArray(queryEcho.types) ? queryEcho.types : undefined;
  const repoIds = Array.isArray(queryEcho.repo_ids) ? queryEcho.repo_ids : undefined;
  if (
    queryEcho.query !== query ||
    !types ||
    !sameElements(types, ["compose"]) ||
    queryEcho.locale !== "en_US" ||
    !repoIds ||
    !sameElements(repoIds, trusted)
  ) {
    failEcho();
  }

  const status = envelope.status;
  if (!isRecord(status) || !isRecord(status.repo)) failEcho();
  const repoStatus = status.repo;
  if (!Array.isArray(repoStatus.failed) || repoStatus.failed.length > 0) failEcho();
  if (
    !Array.isArray(repoStatus.succeeded) ||
    !sameElements(repoStatus.succeeded, trusted)
  )
    failEcho();

  return { rows, total, totalPages };
}

function normalizePageRows(
  rows: readonly unknown[],
  trusted: readonly string[],
  client: DiscoveryClient,
): StoreDiscoveryItem[] {
  const normalized: StoreDiscoveryItem[] = [];
  for (const raw of rows) {
    const item = normalizeStoreDiscoveryItem(raw, undefined, false);
    if (!trusted.includes(item.repo_id)) failEcho();
    client.assertStoreDiscoverySafe(item);
    normalized.push(item);
  }
  return normalized;
}

function bytewiseSort(values: string[]): string[] {
  return values.sort(bytewiseCompare);
}

function sortedApps(apps: StoreDiscoveryItem[]): StoreDiscoveryItem[] {
  return apps.sort((left, right) =>
    bytewiseCompare(left.repo_id, right.repo_id) !== 0
      ? bytewiseCompare(left.repo_id, right.repo_id)
      : bytewiseCompare(left.app_id, right.app_id),
  );
}

/**
 * Search the enabled, v2/http trusted repositories for `input`.
 *
 * Returns at most `limit` deterministically bytewise-sorted, de-duplicated
 * normalized rows plus a truncation flag. Every failure is a fixed-code
 * AppError; no upstream content is reflected.
 */
export async function searchAppStore(
  client: DiscoveryClient,
  input: unknown,
): Promise<StoreSearchResult> {
  const { query, limit } = validateStoreSearchInput(input);

  const repositories = normalizeStoreRepositories(await client.getStoreRepositories());
  const trusted = bytewiseSort(repositories.map((repository) => repository.id));
  if (trusted.length === 0) return { apps: [], truncated: false };

  const apps: StoreDiscoveryItem[] = [];
  const seen = new Set<string>();
  let snapshot: { readonly total: number; readonly totalPages: number } | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const envelope = await client.getStoreSearchPage(query, trusted, page);
    const verified = verifySearchEnvelope(envelope, page, query, trusted);
    if (
      snapshot !== undefined &&
      (verified.total !== snapshot.total || verified.totalPages !== snapshot.totalPages)
    ) {
      // The pagination snapshot must be stable across the fetched pages.
      failEcho();
    }
    snapshot = verified;

    const rows = normalizePageRows(verified.rows, trusted, client);
    for (const row of rows) {
      const key = `${row.repo_id}:${row.app_id}`;
      if (seen.has(key)) failEcho();
      seen.add(key);
      apps.push(row);
    }

    if (page >= verified.totalPages) break; // the final page was fetched
  }

  const sorted = sortedApps(apps);
  const truncated = (snapshot?.totalPages ?? 0) > MAX_PAGES || apps.length > limit;
  return { apps: sorted.slice(0, limit), truncated };
}

/**
 * Fetch the bounded detail of one exact store selection.
 *
 * The selection must identify an enabled v2/http repository in the fresh
 * listing; the detail is normalized against the selection and must pass
 * the no-I/O metadata guard.
 */
export async function getAppStoreDetails(
  client: DiscoveryClient,
  selection: StoreSelection,
): Promise<StoreDiscoveryDetail> {
  assertStoreSelection(selection);

  const repositories = normalizeStoreRepositories(await client.getStoreRepositories());
  if (!repositories.some((repository) => repository.id === selection.repoId)) {
    throw new AppError(
      "ZIMAOS_BAD_REQUEST",
      "The requested store repository is not supported.",
    );
  }

  const detail = normalizeStoreDiscoveryItem(
    await client.getStoreAppDetail(selection),
    selection,
    true,
  );
  client.assertStoreDiscoverySafe(detail);
  return detail;
}
