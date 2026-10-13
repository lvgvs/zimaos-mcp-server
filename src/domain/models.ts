/**
 * Normalized domain models.
 *
 * These are the shapes MCP tools return to clients. They deliberately do NOT
 * mirror raw ZimaOS payloads; each has a normalizer that maps an upstream
 * response (typed loosely) into this model, dropping anything we don't need and
 * never leaking credentials or internal identifiers beyond what is useful.
 */

// ---------------------------------------------------------------------------
// System / device info  (GET /v2/zimaos/device/info — bare payload)
// ---------------------------------------------------------------------------

export interface CpuInfo {
  model?: string;
  cores?: number;
  threads?: number;
}

export interface MemoryInfo {
  totalBytes?: number;
  type?: string;
}

export interface SystemInfo {
  /** Hostname / device name. */
  hostname?: string;
  /** Device model (e.g. "Generic-x86_64"). */
  model?: string;
  /** CPU architecture (e.g. "x86_64", "aarch64"). */
  architecture?: string;
  /** ZimaOS version string (e.g. "v1.7.1"). */
  osVersion?: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  memoryTotalBytes?: number;
  memoryType?: string;
}

// ---------------------------------------------------------------------------
// Compose apps (GET /v2/app_management/compose — { data: map<id, entry> })
// ---------------------------------------------------------------------------

export interface AppInfo {
  /** Stable app id (the key in the upstream `data` map). */
  id: string;
  /** Display name derived from store info, falling back to the id. */
  name?: string;
  /** Raw status string reported by ZimaOS (e.g. "running", "stopped"). */
  status?: string;
  updateAvailable?: boolean;
  isUncontrolled?: boolean;
  /**
   * Optional configured main service, reported verbatim from
   * `store_info.main` when it is a valid bounded service name. This is
   * declared store metadata only — not a claim of native installation
   * origin, runtime health or actual runtime primacy. Omitted when missing
   * or invalid.
   */
  mainService?: string;
}

// ---------------------------------------------------------------------------
// Containers (GET /v2/app_management/compose/{id}/containers)
//   -> { data: { main: <service>, containers: map<service, container> } }
// ---------------------------------------------------------------------------

export interface PortMapping {
  protocol?: string;
  publishedPort?: number | string;
  targetPort?: number | string;
  url?: string;
}

export interface ContainerInfo {
  id?: string;
  name?: string;
  image?: string;
  service?: string;
  state?: string;
  status?: string;
  health?: string;
  ports: PortMapping[];
  /**
   * Optional declaration flag: true when this member's source map key is the
   * declared `main` service, false for other members. Present on every
   * member only when the root `main` is a valid bounded service name
   * matching an own non-array object entry in `containers`. Omitted entirely
   * otherwise, and omitted for a member whose reported `Service` contradicts
   * its map key. A projection of reported declaration, not proof of runtime
   * primacy or health.
   */
  isMainService?: boolean;
}

// ---------------------------------------------------------------------------
// Logs (bounded tail)
// ---------------------------------------------------------------------------

export interface AppLogs {
  app: string;
  /** Service/container the logs were read from, if a specific one was chosen. */
  container?: string;
  lines: string[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Normalizers (pure)
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Valid upstream locale key: 2-letter code, optional 2-8 char subtag. */
const LOCALE_KEY_RE = /^[a-z]{2}(?:[_-][A-Za-z0-9]{2,8})?$/;

/** Display-title hard cap: 256 UTF-8 bytes, no silent truncation. */
const MAX_TITLE_UTF8_BYTES = 256;

/** Examine at most 32 own locale properties; larger maps are malformed. */
const MAX_LOCALIZATION_ENTRIES = 32;

/** Bounded service name for `store_info.main`: 1-128 chars. */
const MAIN_SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isOwnRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve a display name from `store_info.title`.
 *
 * Plain strings keep their legacy behavior as-is, with the historical
 * empty-string fallback to the id (the old `asString` semantics). A non-null
 * record is a
 * localized map: at most 32 own locale keys, each a valid nonblank string of
 * at most 256 UTF-8 bytes. Preference order: `en_us`, then `en`, then
 * deterministic lexical order of the remaining valid locale keys. Only own
 * properties are considered (arrays, numbers and prototype values are
 * ignored). Any malformed map falls back to the id; valid titles are never
 * trimmed or truncated.
 */
function resolveLocalizedName(
  title: unknown,
  fallbackId: string,
  acceptsMetadata: (value: string) => boolean,
): string {
  if (typeof title === "string") return title.length > 0 ? title : fallbackId;
  if (!isOwnRecord(title)) return fallbackId;

  const ownKeys = Object.keys(title);
  if (ownKeys.length > MAX_LOCALIZATION_ENTRIES) return fallbackId;

  const candidates: string[] = [];
  for (const key of ownKeys) {
    if (!LOCALE_KEY_RE.test(key)) continue;
    const value = title[key];
    if (typeof value !== "string") continue;
    // UTF-8 byte count is at least the UTF-16 code-unit count. Reject oversized
    // values before trim or encoding can allocate an unbounded temporary.
    if (value.length > MAX_TITLE_UTF8_BYTES) continue;
    if (value.trim().length === 0) continue;
    if (new TextEncoder().encode(value).length > MAX_TITLE_UTF8_BYTES) continue;
    if (!acceptsMetadata(value)) continue;
    candidates.push(key);
  }
  if (candidates.length === 0) return fallbackId;

  const preferred = ["en_us", "en"].filter((key) => candidates.includes(key));
  const ordered =
    preferred.length > 0
      ? preferred
      : candidates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const chosenKey = ordered[0]!;
  return title[chosenKey] as string;
}

/** Map a raw `device/info` payload into SystemInfo. */
export function normalizeSystemInfo(raw: Record<string, unknown>): SystemInfo {
  const cpu = (raw["cpu"] ?? {}) as Record<string, unknown>;
  const memory = (raw["memory"] ?? {}) as Record<string, unknown>;

  return {
    hostname: asString(raw["device_name"]),
    model: asString(raw["device_model"]),
    architecture: asString(raw["arch"]),
    osVersion: asString(raw["os_version"]),
    cpuModel: asString(cpu["model"]),
    cpuCores: asNumber(cpu["cores"]),
    cpuThreads: asNumber(cpu["threads"]),
    memoryTotalBytes: asNumber(memory["total_byte"]) ?? asNumber(memory["total_bytes"]),
    memoryType: asString(memory["type"]),
  };
}

/**
 * Map the compose list payload into AppInfo[]. The upstream `data` field is a
 * map keyed by app id; we also tolerate an array form defensively.
 */
export function normalizeAppList(
  rawData: unknown,
  acceptsMetadata: (value: string) => boolean = () => true,
): AppInfo[] {
  const entries: Array<[string, Record<string, unknown>]> = [];

  if (Array.isArray(rawData)) {
    for (const item of rawData) {
      if (typeof item === "object" && item !== null) {
        const rec = item as Record<string, unknown>;
        const id = asString(rec["id"]) ?? asString(rec["name"]);
        entries.push([id ?? `app_${entries.length}`, rec]);
      }
    }
  } else if (typeof rawData === "object" && rawData !== null) {
    for (const [key, value] of Object.entries(rawData)) {
      if (typeof value === "object" && value !== null) {
        entries.push([key, value as Record<string, unknown>]);
      }
    }
  }

  return entries.map(([id, rec]) => normalizeAppEntry(id, rec, acceptsMetadata));
}

function normalizeAppEntry(
  id: string,
  rec: Record<string, unknown>,
  acceptsMetadata: (value: string) => boolean,
): AppInfo {
  const store = (rec["store_info"] ?? {}) as Record<string, unknown>;
  // `title` may be null for some apps; fall back to the id. Plain-string
  // titles keep their legacy behavior; localized maps resolve per
  // resolveLocalizedName, which also falls back to the id when malformed.
  const name = resolveLocalizedName(store["title"], id, acceptsMetadata);

  const main =
    isOwnRecord(store) && Object.prototype.hasOwnProperty.call(store, "main")
      ? store["main"]
      : undefined;
  const app: AppInfo = {
    id,
    name,
    status: asString(rec["status"]),
    updateAvailable: asBool(rec["update_available"]),
    isUncontrolled: asBool(rec["is_uncontrolled"]),
  };
  // Declared configured metadata only; omitted unless valid and bounded.
  if (typeof main === "string" && MAIN_SERVICE_RE.test(main) && acceptsMetadata(main)) {
    app.mainService = main;
  }
  return app;
}

/** Map the containers payload into ContainerInfo[]. */
export function normalizeContainers(rawData: unknown): ContainerInfo[] {
  if (typeof rawData !== "object" || rawData === null) return [];
  const data = rawData as Record<string, unknown>;
  const containers = data["containers"];
  if (typeof containers !== "object" || containers === null) return [];
  const containersRec = containers as Record<string, unknown>;

  // The declared main service must be a valid bounded service name matching
  // an OWN non-array object entry in `containers`; otherwise no member gets
  // the flag (no first/sole-service inference). Only OWN payload properties
  // are considered: a `main`/`containers` inherited from the payload
  // prototype chain never manufactures the declaration.
  const main = Object.prototype.hasOwnProperty.call(data, "main")
    ? data["main"]
    : undefined;
  const mainDeclared =
    typeof main === "string" &&
    MAIN_SERVICE_RE.test(main) &&
    Object.prototype.hasOwnProperty.call(data, "containers") &&
    isOwnRecord(containers) &&
    Object.prototype.hasOwnProperty.call(containersRec, main) &&
    isOwnRecord(containersRec[main]);

  const result: ContainerInfo[] = [];
  for (const [service, value] of Object.entries(containersRec)) {
    if (typeof value !== "object" || value === null) continue;
    const container = normalizeContainer(service, value as Record<string, unknown>);
    if (mainDeclared && container.service === service) {
      container.isMainService = service === main;
    }
    result.push(container);
  }
  return result;
}

function normalizeContainer(
  service: string,
  rec: Record<string, unknown>,
): ContainerInfo {
  const publishers = Array.isArray(rec["Publishers"]) ? rec["Publishers"] : [];
  const ports: PortMapping[] = [];
  for (const p of publishers) {
    if (typeof p !== "object" || p === null) continue;
    const pr = p as Record<string, unknown>;
    ports.push({
      protocol: asString(pr["Protocol"]),
      publishedPort: asNumber(pr["PublishedPort"]) ?? asString(pr["PublishedPort"]),
      targetPort: asNumber(pr["TargetPort"]) ?? asString(pr["TargetPort"]),
      url: asString(pr["URL"]),
    });
  }

  return {
    id: asString(rec["ID"]),
    name: asString(rec["Name"]),
    image: asString(rec["Image"]),
    service: asString(rec["Service"]) ?? service,
    state: asString(rec["State"]),
    status: asString(rec["Status"]),
    health: asString(rec["Health"]),
    ports,
  };
}
