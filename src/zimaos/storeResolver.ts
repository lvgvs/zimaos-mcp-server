/**
 * Read-only store Compose resolution (Phase 6 slice).
 *
 * Bounded, sequential resolution of a caller-selected store item into the
 * authoritative, repository-associated Compose source the shared install
 * machinery will consume:
 *
 *   1. the selection is validated BEFORE any catalog traffic;
 *   2. a fresh repository listing is normalized and must contain the exact
 *      selected enabled `v2`/`http` repository id;
 *   3. the caller's current architecture is read;
 *   4. the exact app detail is normalized for that architecture;
 *   5. only the normalized detail is used to fetch the store Compose;
 *   6. the fetched document is associated with its repository via the
 *      shared, verified AST edit.
 *
 * No URL construction, caching, fallback, version selection, search, or
 * mutation happens here. All parsing and security decisions are owned by
 * `storeCatalog` and the client; this module only sequences the reads and
 * maps "not a supported store item" to a fixed `ZIMAOS_BAD_REQUEST`.
 * Upstream `AppError`s from the client propagate sanitized, unwrapped.
 */

import { AppError } from "../errors.js";
import type { ZimaOsClient } from "./client.js";
import type { StoreDetail, StoreSelection } from "./storeCatalog.js";
import {
  associateStoreCompose,
  assertStoreSelection,
  normalizeStoreDetail,
  normalizeStoreRepositories,
} from "./storeCatalog.js";

/** The resolver only needs the four catalog reads of the native client. */
export type StoreReadClient = Pick<
  ZimaOsClient,
  | "getStoreRepositories"
  | "getAppManagementArchitecture"
  | "getStoreAppDetail"
  | "getStoreCompose"
>;

/** The resolved store item: authoritative source + verified name + detail. */
export interface ResolvedStoreCompose {
  readonly source: string;
  readonly name: string;
  readonly detail: StoreDetail;
}

/** Fixed sanitized message: the selection does not identify a supported item. */
const UNSUPPORTED_ITEM_MESSAGE = "The requested store item is not supported.";

/**
 * Resolve `selection` to its authoritative, repository-associated store
 * Compose source.
 *
 * - invalid selection                -> AppError INPUT_INVALID, zero reads;
 * - unregistered/disabled repository -> AppError ZIMAOS_BAD_REQUEST, zero
 *   architecture/detail/Compose reads;
 * - malformed registry               -> AppError ZIMAOS_UPSTREAM_ERROR, zero
 *   architecture/detail/Compose reads;
 * - anything downstream (detail, compose, association) -> the shared
 *   module's fixed-code AppErrors; upstream client AppErrors propagate.
 */
export async function resolveStoreCompose(
  client: StoreReadClient,
  selection: StoreSelection,
): Promise<ResolvedStoreCompose> {
  assertStoreSelection(selection);

  const repositories = normalizeStoreRepositories(await client.getStoreRepositories());
  if (!repositories.some((repository) => repository.id === selection.repoId)) {
    throw new AppError("ZIMAOS_BAD_REQUEST", UNSUPPORTED_ITEM_MESSAGE);
  }

  const architecture = await client.getAppManagementArchitecture();
  const detail = normalizeStoreDetail(
    await client.getStoreAppDetail(selection),
    selection,
    architecture,
  );
  const compose = await client.getStoreCompose(detail);
  const associated = associateStoreCompose(compose, selection);

  return { source: associated.source, name: associated.name, detail };
}
