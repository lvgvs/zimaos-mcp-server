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
export function normalizeAppList(rawData: unknown): AppInfo[] {
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

  return entries.map(([id, rec]) => normalizeAppEntry(id, rec));
}

function normalizeAppEntry(id: string, rec: Record<string, unknown>): AppInfo {
  const store = (rec["store_info"] ?? {}) as Record<string, unknown>;
  // `title` may be null for some apps; fall back to the id.
  const title = asString(store["title"]);

  return {
    id,
    name: title ?? id,
    status: asString(rec["status"]),
    updateAvailable: asBool(rec["update_available"]),
    isUncontrolled: asBool(rec["is_uncontrolled"]),
  };
}

/** Map the containers payload into ContainerInfo[]. */
export function normalizeContainers(rawData: unknown): ContainerInfo[] {
  if (typeof rawData !== "object" || rawData === null) return [];
  const data = rawData as Record<string, unknown>;
  const containers = data["containers"];
  if (typeof containers !== "object" || containers === null) return [];

  const result: ContainerInfo[] = [];
  for (const [service, value] of Object.entries(containers)) {
    if (typeof value !== "object" || value === null) continue;
    result.push(normalizeContainer(service, value as Record<string, unknown>));
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
