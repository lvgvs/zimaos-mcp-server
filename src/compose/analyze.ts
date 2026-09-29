/**
 * Risk analysis for parsed Docker Compose documents.
 *
 * `analyzeCompose` inspects each service definition in a `ParseComposeResult`
 * (plus top-level volume definitions) and reports high-risk patterns as
 * `RiskFinding`s: privileged mode, host network/pid/ipc/uts/cgroup
 * namespaces, the ZimaOS API socket flag, volumes that bind the Docker daemon
 * socket (or its parent directories), binds of sensitive host filesystem paths
 * (and their ancestors), device passthrough and cgroup rules, capability
 * additions, security-option relaxations, `volumes_from` sharing, and
 * top-level named-volume definitions whose `driver_opts` point at a bind
 * source.
 *
 * Findings are structured with fixed categories/descriptions; they disclose
 * risk for later approval and never classify host-control constructs as safe.
 * Checked fields must have exact types; a wrong type, an ambiguous long mount
 * type, an invalid volume source/target/mode, Compose/YAML interpolation
 * (`${...}`) in any checked field, or external indirection that hides service
 * definitions from inspection (top-level `include`, service `extends`/`build`)
 * is rejected with a sanitized error that never echoes input content. Benign
 * documents yield `[]`.
 */

import type { ParseComposeResult } from "./parse.js";

/** One reported risk for a single service definition. */
export interface RiskFinding {
  /** Fixed category identifier (no source-derived text). */
  readonly category: string;
  /** Service name the finding applies to. */
  readonly service: string;
  /** Compose field that triggered the finding. */
  readonly field: string;
  /** Fixed, sanitized description (never echoes input content). */
  readonly description: string;
}

/** Fixed, source-free reason phrases for sanitized errors. */
type Reason =
  | "services must be a mapping of mappings"
  | "service definition must be a mapping"
  | "privileged must be a boolean"
  | "network_mode must be a string"
  | "pid must be a string"
  | "ipc must be a string"
  | "uts must be a string"
  | "cgroup must be a string"
  | "use_api_socket must be a boolean"
  | "volumes must be a sequence"
  | "volume entry must be a string or mapping"
  | "ambiguous long mount type"
  | "invalid volume source"
  | "invalid volume target"
  | "invalid volume mode"
  | "top-level include is not inspectable"
  | "service extends is not inspectable"
  | "service build is not inspectable"
  | "devices must be a sequence of strings or mappings"
  | "device entry must be a string or mapping"
  | "device_cgroup_rules must be a sequence of strings"
  | "cap_add must be a sequence of strings"
  | "security_opt must be a sequence of strings"
  | "volumes_from must be a sequence of strings"
  | "top-level volumes must be a mapping"
  | "volume definition must be a mapping"
  | "driver_opts must be a mapping"
  | "interpolation in checked field";

function fail(reason: Reason): never {
  throw new Error(`compose analyze failed: ${reason}`);
}

/** Paths whose bind mount exposes the Docker daemon socket. */
const SOCKET_PATHS = new Set<string>([
  "/var/run/docker.sock",
  "/run/docker.sock",
  // Parent directories: a bind of either parent carries docker.sock with it.
  "/run",
  "/var/run",
]);

/**
 * Sensitive host filesystem paths. A bind source equal to one of these, or an
 * ancestor of one (mounting the ancestor exposes the path), is flagged.
 */
const HOST_FS_SENSITIVE_PATHS: readonly string[] = [
  "/",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/home",
  "/root",
  // Docker runtime/data paths (Docker, containerd, CRI-O, Podman).
  "/var/lib/docker",
  "/run/containerd",
  "/var/run/containerd",
  "/run/podman",
  "/var/run/podman",
  "/run/crio",
  "/var/run/crio",
  "/run/containerd/containerd.sock",
  "/var/run/containerd/containerd.sock",
  "/run/podman/podman.sock",
  "/var/run/podman/podman.sock",
  "/run/crio/crio.sock",
  "/var/run/crio/crio.sock",
];

/** Reject strings containing Compose/YAML interpolation markers. */
function assertNoInterpolation(value: string): void {
  if (value.includes("${")) fail("interpolation in checked field");
}

function checkBooleanField(
  serviceName: string,
  service: Map<string, unknown>,
  key: "privileged" | "use_api_socket",
  findings: RiskFinding[],
  category: string,
  description: string,
): void {
  if (!service.has(key)) return;
  const value = service.get(key);
  if (value === null || typeof value !== "boolean") fail(`${key} must be a boolean`);
  if (value) findings.push({ category, service: serviceName, field: key, description });
}

function checkHostStringField(
  serviceName: string,
  service: Map<string, unknown>,
  key: "network_mode" | "pid" | "ipc" | "uts" | "cgroup",
  findings: RiskFinding[],
): void {
  if (!service.has(key)) return;
  const value = service.get(key);
  if (value === null || typeof value !== "string") fail(`${key} must be a string`);
  assertNoInterpolation(value);
  if (value === "host") {
    findings.push({
      category: `host_${key}`,
      service: serviceName,
      field: key,
      description: `${key} is set to host namespace`,
    });
  }
}

/** True when a short-syntax source denotes a host bind path. */
function isBindSource(source: string): boolean {
  return source.startsWith("/") || source.startsWith("./") || source.startsWith("../");
}

/** Valid mount mode tokens for the short `source:target[:mode]` syntax. */
const VALID_MOUNT_MODES = new Set(["ro", "rw", "z", "Z"]);

function assertValidMountMode(mode: string): void {
  if (mode.length === 0) fail("invalid volume mode");
  for (const token of mode.split(",")) {
    if (!VALID_MOUNT_MODES.has(token)) fail("invalid volume mode");
  }
}

/**
 * Lexically normalize an absolute POSIX path: collapse repeated slashes, drop
 * `.` segments, and resolve `..` against the parent directory (clamped at the
 * root). Returns a canonical form such as `/etc`, or `null` when the input is
 * not an absolute path.
 */
function normalizeAbsolutePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const segments = path.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length > 0) stack.pop(); // clamped at the root.
      continue;
    }
    stack.push(segment);
  }
  return "/" + stack.join("/");
}

/**
 * True when an absolute bind source, after lexical normalization, exposes a
 * sensitive host filesystem path (equal to one, or overlapping it as an
 * ancestor/descendant).
 */
function isSensitiveHostPath(source: string): boolean {
  const normalized = normalizeAbsolutePath(source);
  if (normalized === null) return false;
  for (const sensitive of HOST_FS_SENSITIVE_PATHS) {
    if (sensitive === "/") {
      if (normalized === "/") return true;
      continue;
    }
    // `a` overlaps `b` when one is a path-prefix of the other.
    const a = normalized + "/";
    const b = sensitive + "/";
    if (normalized === sensitive || a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

/** True when an absolute bind source, after lexical normalization, is the Docker daemon socket or its parent. */
function isSocketPath(source: string): boolean {
  const normalized = normalizeAbsolutePath(source);
  if (normalized === null) return false;
  return SOCKET_PATHS.has(normalized);
}

/**
 * True when a relative bind source climbs above the project directory, so its
 * resolved host location may be any ancestor of `/`.
 */
function relativeSourceEscapes(source: string): boolean {
  let depth = 0;
  for (const segment of source.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

function checkVolumes(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("volumes")) return;
  const volumes = service.get("volumes");
  if (volumes === null || !Array.isArray(volumes)) fail("volumes must be a sequence");

  for (const entry of volumes) {
    let hostPath: string | undefined;
    let containerPath: string | undefined;
    let isBind = false;

    if (typeof entry === "string") {
      assertNoInterpolation(entry);
      const parts = entry.split(":");
      if (parts.length > 3) fail("invalid volume mode");
      if (parts.length === 1) {
        // A bare string is an anonymous named volume; no path to check.
        continue;
      }
      const sourcePart = parts[0];
      const targetPart = parts[1];
      if (sourcePart === undefined || targetPart === undefined)
        fail("invalid volume mode");
      hostPath = sourcePart;
      containerPath = targetPart;
      if (hostPath.length === 0) fail("invalid volume source");
      if (containerPath.length === 0) fail("invalid volume target");
      isBind = isBindSource(hostPath);
      const modePart = parts[2];
      if (modePart !== undefined) assertValidMountMode(modePart);
    } else if (entry instanceof Map) {
      const source = entry.get("source");
      const target = entry.get("target");
      const type = entry.get("type");

      // Reject interpolation before any other classification.
      if (typeof source === "string") assertNoInterpolation(source);
      if (typeof target === "string") assertNoInterpolation(target);

      let explicitType: string | undefined;
      if (type !== undefined && type !== null) {
        if (typeof type !== "string" || (type !== "bind" && type !== "volume")) {
          fail("ambiguous long mount type");
        }
        explicitType = type;
      }

      if (explicitType === "bind") {
        isBind = true;
        if (typeof source !== "string" || source.length === 0)
          fail("invalid volume source");
        hostPath = source;
      } else if (explicitType === "volume") {
        // Named volume: no host path to check.
        continue;
      } else if (source !== undefined && source !== null) {
        if (typeof source !== "string" || source.length === 0)
          fail("invalid volume source");
        isBind = isBindSource(source);
        hostPath = source;
      } else {
        // No source: an anonymous named volume; no path to check.
        continue;
      }

      if (isBind && (target === undefined || typeof target !== "string")) {
        fail("invalid volume target");
      }
      containerPath = typeof target === "string" ? target : undefined;
    } else {
      fail("volume entry must be a string or mapping");
    }

    if (hostPath !== undefined) {
      const socketSide = [hostPath, containerPath].find(
        (p) => p !== undefined && isSocketPath(p),
      );
      if (socketSide !== undefined) {
        findings.push({
          category: "docker_socket",
          service: serviceName,
          field: "volumes",
          description: "volume binds the Docker daemon socket or its parent directory",
        });
      } else if (isBind) {
        const sensitive = hostPath.startsWith("/")
          ? isSensitiveHostPath(hostPath)
          : relativeSourceEscapes(hostPath);
        if (sensitive) {
          findings.push({
            category: "host_fs_bind",
            service: serviceName,
            field: "volumes",
            description: "volume binds a sensitive host filesystem path or its ancestor",
          });
        }
      }
    }
  }
}

/** Check `devices` entries (string shorthand and long mappings). */
function checkDevices(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("devices")) return;
  const devices = service.get("devices");
  if (devices === null || !Array.isArray(devices)) {
    fail("devices must be a sequence of strings or mappings");
  }

  for (const entry of devices) {
    if (typeof entry === "string") {
      assertNoInterpolation(entry);
    } else if (entry instanceof Map) {
      const source = entry.get("source");
      if (typeof source === "string") assertNoInterpolation(source);
    } else {
      fail("device entry must be a string or mapping");
    }

    findings.push({
      category: "device_passthrough",
      service: serviceName,
      field: "devices",
      description: "host device is passed through to the container",
    });
  }
}

/** Check `device_cgroup_rules` (any rule grants host cgroup access). */
function checkDeviceCgroupRules(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("device_cgroup_rules")) return;
  const rules = service.get("device_cgroup_rules");
  if (rules === null || !Array.isArray(rules))
    fail("device_cgroup_rules must be a sequence of strings");
  for (const rule of rules) {
    if (typeof rule !== "string")
      fail("device_cgroup_rules must be a sequence of strings");
    assertNoInterpolation(rule);
  }
  findings.push({
    category: "device_cgroup_rules",
    service: serviceName,
    field: "device_cgroup_rules",
    description: "host device cgroup rules grant container access to host devices",
  });
}

/** Check `cap_add` (any added capability is a privilege escalation). */
function checkCapAdd(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("cap_add")) return;
  const caps = service.get("cap_add");
  if (caps === null || !Array.isArray(caps))
    fail("cap_add must be a sequence of strings");
  for (const cap of caps) {
    if (typeof cap !== "string") fail("cap_add must be a sequence of strings");
    assertNoInterpolation(cap);
  }
  findings.push({
    category: "cap_add",
    service: serviceName,
    field: "cap_add",
    description: "Linux capabilities are added to the container",
  });
}

/** Check `security_opt` (any entry relaxes container security). */
function checkSecurityOpt(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("security_opt")) return;
  const opts = service.get("security_opt");
  if (opts === null || !Array.isArray(opts))
    fail("security_opt must be a sequence of strings");
  for (const opt of opts) {
    if (typeof opt !== "string") fail("security_opt must be a sequence of strings");
    assertNoInterpolation(opt);
  }
  findings.push({
    category: "security_opt",
    service: serviceName,
    field: "security_opt",
    description: "container security options are relaxed",
  });
}

/** Check `volumes_from` (shares another container's volume mounts). */
function checkVolumesFrom(
  serviceName: string,
  service: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!service.has("volumes_from")) return;
  const from = service.get("volumes_from");
  if (from === null || !Array.isArray(from))
    fail("volumes_from must be a sequence of strings");
  for (const entry of from) {
    if (typeof entry !== "string") fail("volumes_from must be a sequence of strings");
    assertNoInterpolation(entry);
  }
  findings.push({
    category: "volumes_from",
    service: serviceName,
    field: "volumes_from",
    description: "volume mounts are inherited from another container",
  });
}

/**
 * Check top-level named-volume definitions for `driver_opts` that point at a
 * bind source (bind indirection hides the host path behind a volume name).
 */
function checkTopLevelVolumes(
  document: Map<string, unknown>,
  findings: RiskFinding[],
): void {
  if (!document.has("volumes")) return;
  const volumes = document.get("volumes");
  if (volumes === null) return; // `volumes:` with no definitions.
  if (!(volumes instanceof Map)) fail("top-level volumes must be a mapping");

  for (const [name, def] of volumes) {
    if (typeof name !== "string") fail("volume definition must be a mapping");
    if (def === null || def === undefined) continue; // bare named volume.
    if (!(def instanceof Map)) fail("volume definition must be a mapping");

    const driverOpts = def.get("driver_opts");
    if (driverOpts === undefined || driverOpts === null) continue;
    if (!(driverOpts instanceof Map)) fail("driver_opts must be a mapping");

    let bindSource: string | undefined;
    for (const [key, value] of driverOpts) {
      if (typeof key !== "string") fail("driver_opts must be a mapping");
      if (value === null || typeof value !== "string") continue;
      assertNoInterpolation(value);
    }

    const typeValue = driverOpts.get("type");
    const sourceValue = driverOpts.get("source");
    if (typeof typeValue === "string") assertNoInterpolation(typeValue);
    if (typeof sourceValue === "string") assertNoInterpolation(sourceValue);

    if (typeValue !== undefined && typeValue !== null) {
      if (
        typeof typeValue !== "string" ||
        (typeValue !== "bind" && typeValue !== "volume")
      ) {
        fail("ambiguous long mount type");
      }
      bindSource = typeValue === "bind" ? sourceValue : undefined;
    } else if (sourceValue !== undefined && sourceValue !== null) {
      // A `source` option without an explicit driver type is a bind indirection.
      bindSource = typeof sourceValue === "string" ? sourceValue : undefined;
    }

    if (bindSource !== undefined && bindSource !== null) {
      if (typeof bindSource !== "string" || bindSource.length === 0)
        fail("invalid volume source");
      findings.push({
        category: "named_volume_bind",
        service: name,
        field: "volumes",
        description: "top-level named volume uses a driver_opts bind source",
      });
    }
  }
}

/**
 * Analyze a parsed compose document for high-risk patterns.
 *
 * Returns findings in deterministic order (document service order, then
 * field order; top-level volume definitions last). Throws a sanitized error
 * when a checked field has an invalid type or contains interpolation; the
 * message never echoes input content.
 */
export function analyzeCompose(parsed: ParseComposeResult): RiskFinding[] {
  if (parsed.document.has("include")) fail("top-level include is not inspectable");
  const services = parsed.document.get("services");
  if (services !== undefined && !(services instanceof Map)) {
    fail("services must be a mapping of mappings");
  }

  const findings: RiskFinding[] = [];

  for (const [serviceName, def] of services ?? []) {
    if (typeof serviceName !== "string") fail("service definition must be a mapping");
    // `service:` shorthand leaves the value null; nothing to analyze.
    if (def === null || def === undefined) continue;
    if (!(def instanceof Map)) fail("service definition must be a mapping");
    if (def.has("extends")) fail("service extends is not inspectable");
    if (def.has("build")) fail("service build is not inspectable");

    checkBooleanField(
      serviceName,
      def,
      "privileged",
      findings,
      "privileged",
      "container runs privileged",
    );
    checkHostStringField(serviceName, def, "network_mode", findings);
    checkHostStringField(serviceName, def, "pid", findings);
    checkHostStringField(serviceName, def, "ipc", findings);
    checkHostStringField(serviceName, def, "uts", findings);
    checkHostStringField(serviceName, def, "cgroup", findings);
    checkBooleanField(
      serviceName,
      def,
      "use_api_socket",
      findings,
      "api_socket",
      "service uses the ZimaOS API socket",
    );
    checkVolumes(serviceName, def, findings);
    checkDevices(serviceName, def, findings);
    checkDeviceCgroupRules(serviceName, def, findings);
    checkCapAdd(serviceName, def, findings);
    checkSecurityOpt(serviceName, def, findings);
    checkVolumesFrom(serviceName, def, findings);
  }

  checkTopLevelVolumes(parsed.document, findings);

  return findings;
}
