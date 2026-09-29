import { describe, expect, it } from "vitest";
import { analyzeCompose } from "../src/compose/analyze.js";
import type { RiskFinding } from "../src/compose/analyze.js";
import { parseCompose } from "../src/compose/parse.js";

/**
 * Deterministic tests for the basic compose risk analyzer
 * (`src/compose/analyze.ts`).
 *
 * Documents are parsed with `parseCompose` first, so these tests also pin
 * the parser result shape feeding the analyzer. Rejections assert exact
 * sanitized messages: any source-derived text in a message would break the
 * assertion (no-echo guarantee).
 */

function analyze(source: string): RiskFinding[] {
  return analyzeCompose(parseCompose(source));
}

function expectRejected(source: string, reason: string): void {
  try {
    analyze(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe(`compose analyze failed: ${reason}`);
    return;
  }
  throw new Error(`expected rejection with reason "${reason}"`);
}

describe("benign documents", () => {
  it("returns [] for ports, images, and named volumes (short + long syntax)", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:alpine",
      "    ports:",
      '      - "8080:80"',
      "    volumes:",
      "      - data:/data", // named volume, short syntax
      "      - myvol", // bare anonymous named volume
      "      - source: cache", // long-syntax named volume (no host path)
      "        target: /cache",
      "  db:",
      "    image: postgres:16",
      "    volumes:",
      '      - "./pgdata:/var/lib/postgresql/data"', // harmless bind
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([]);
  });

  it("returns [] for privileged false and non-host namespaces", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    privileged: false",
      "    network_mode: bridge",
      "    pid: container:other",
      "    ipc: private",
      "    use_api_socket: false",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([]);
  });

  it("returns [] when the document has no services key at all", () => {
    const source = ["name: empty", "volumes:", "  data: {}", ""].join("\n");
    expect(analyze(source)).toEqual([]);
  });
});

describe("privileged", () => {
  it("flags privileged true with service, field, and fixed description", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    privileged: true",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "privileged",
        service: "web",
        field: "privileged",
        description: "container runs privileged",
      },
    ]);
  });

  it("flags merge-inherited privileged (<< anchor) on the inheriting service", () => {
    const source = [
      "services:",
      "  base: &base",
      "    privileged: true",
      "  web:",
      "    <<: *base",
      "    image: nginx",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "privileged",
        service: "base",
        field: "privileged",
        description: "container runs privileged",
      },
      {
        category: "privileged",
        service: "web",
        field: "privileged",
        description: "container runs privileged",
      },
    ]);
  });
});

describe("host namespaces", () => {
  it("flags network_mode, pid, and ipc set to host in field order", () => {
    const source = [
      "services:",
      "  agent:",
      "    image: zimaos-agent",
      "    network_mode: host",
      "    pid: host",
      "    ipc: host",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "host_network_mode",
        service: "agent",
        field: "network_mode",
        description: "network_mode is set to host namespace",
      },
      {
        category: "host_pid",
        service: "agent",
        field: "pid",
        description: "pid is set to host namespace",
      },
      {
        category: "host_ipc",
        service: "agent",
        field: "ipc",
        description: "ipc is set to host namespace",
      },
    ]);
  });
});

describe("use_api_socket", () => {
  it("flags use_api_socket true and not false", () => {
    const source = [
      "services:",
      "  agent:",
      "    image: zimaos-agent",
      "    use_api_socket: true",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "api_socket",
        service: "agent",
        field: "use_api_socket",
        description: "service uses the ZimaOS API socket",
      },
    ]);
  });
});

describe("docker daemon socket volumes", () => {
  it("flags short-syntax bind of /var/run/docker.sock and /run/docker.sock", () => {
    const source = [
      "services:",
      "  a:",
      "    image: x",
      "    volumes:",
      '      - "/var/run/docker.sock:/var/run/docker.sock"',
      "  b:",
      "    image: x",
      "    volumes:",
      '      - "/run/docker.sock:/sock"',
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "docker_socket",
        service: "a",
        field: "volumes",
        description: "volume binds the Docker daemon socket or its parent directory",
      },
      {
        category: "docker_socket",
        service: "b",
        field: "volumes",
        description: "volume binds the Docker daemon socket or its parent directory",
      },
    ]);
  });

  it("flags long-syntax source and parent-directory binds (/run, /var/run)", () => {
    const source = [
      "services:",
      "  a:",
      "    image: x",
      "    volumes:",
      "      - source: /run/docker.sock",
      "        target: /sock",
      "  b:",
      "    image: x",
      "    volumes:",
      '      - "/run:/host-run"',
      "  c:",
      "    image: x",
      "    volumes:",
      "      - source: /var/run",
      "        target: /var/run",
      "",
    ].join("\n");
    const findings = analyze(source);
    expect(findings.map((f) => f.service)).toEqual(["a", "b", "c"]);
    for (const finding of findings) {
      expect(finding.category).toBe("docker_socket");
      expect(finding.field).toBe("volumes");
    }
  });

  it("flags a socket path on the container side too", () => {
    const source = [
      "services:",
      "  a:",
      "    image: x",
      "    volumes:",
      '      - "/tmp/sock:/var/run/docker.sock"',
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "docker_socket",
        service: "a",
        field: "volumes",
        description: "volume binds the Docker daemon socket or its parent directory",
      },
    ]);
  });
});

describe("sanitized errors (no input echo)", () => {
  it("rejects external includes and service indirection", () => {
    expectRejected(
      "include: [other.yml]\nservices: {}\n",
      "top-level include is not inspectable",
    );
    expectRejected(
      "services:\n  web:\n    extends: other\n",
      "service extends is not inspectable",
    );
    expectRejected(
      "services:\n  web:\n    build: .\n",
      "service build is not inspectable",
    );
  });

  it("does not skip named-volume bind analysis when services is absent", () => {
    const findings = analyze(
      "volumes:\n  hidden:\n    driver_opts:\n      type: bind\n      source: /etc\n",
    );
    expect(findings.map((finding) => finding.category)).toEqual(["named_volume_bind"]);
  });

  it("detects a socket target with a short-mount mode suffix", () => {
    const findings = analyze(
      'services:\n  web:\n    volumes:\n      - "/tmp/sock:/var/run/docker.sock:ro"\n',
    );
    expect(findings.map((finding) => finding.category)).toEqual(["docker_socket"]);
  });

  it("detects normalized sensitive and socket paths", () => {
    const findings = analyze(
      'services:\n  web:\n    volumes:\n      - "/etc/../etc:/host-etc"\n      - "//var///run/docker.sock:/sock:ro"\n',
    );
    expect(findings.map((finding) => finding.category)).toEqual([
      "host_fs_bind",
      "docker_socket",
    ]);
  });

  it("rejects privileged with a non-boolean type", () => {
    expectRejected(
      ["services:", "  web:", "    image: nginx", '    privileged: "yes"', ""].join("\n"),
      "privileged must be a boolean",
    );
  });

  it("rejects use_api_socket with a non-boolean type", () => {
    expectRejected(
      ["services:", "  web:", "    image: nginx", "    use_api_socket: on", ""].join(
        "\n",
      ),
      "use_api_socket must be a boolean",
    );
  });

  it("rejects interpolation in network_mode", () => {
    expectRejected(
      ["services:", "  web:", "    image: nginx", "    network_mode: ${MODE}", ""].join(
        "\n",
      ),
      "interpolation in checked field",
    );
  });

  it("rejects interpolation in a long-syntax volume source", () => {
    expectRejected(
      [
        "services:",
        "  web:",
        "    image: nginx",
        "    volumes:",
        "      - source: ${SOCK}",
        "        target: /var/run/docker.sock",
        "",
      ].join("\n"),
      "interpolation in checked field",
    );
  });

  it("rejects a short-syntax volume containing interpolation", () => {
    expectRejected(
      [
        "services:",
        "  web:",
        "    image: nginx",
        "    volumes:",
        '      - "${SOCK}:/var/run/docker.sock"',
        "",
      ].join("\n"),
      "interpolation in checked field",
    );
  });

  it("rejects a non-sequence volumes value", () => {
    expectRejected(
      ["services:", "  web:", "    image: nginx", "    volumes: nope", ""].join("\n"),
      "volumes must be a sequence",
    );
  });
});

describe("host filesystem bind sources", () => {
  it("flags short-syntax binds of sensitive host paths (/, /etc, /proc, /sys, /dev, /home, /root)", () => {
    const source = [
      "services:",
      "  a:",
      "    image: x",
      "    volumes:",
      '      - "/:/host-root"',
      '      - "/etc:/host-etc"',
      '      - "/proc:/host-proc"',
      '      - "/sys:/host-sys"',
      '      - "/dev:/host-dev"',
      '      - "/home:/host-home"',
      '      - "/root:/host-root2"',
      "",
    ].join("\n");
    const findings = analyze(source);
    expect(findings.map((f) => f.service)).toEqual(["a", "a", "a", "a", "a", "a", "a"]);
    for (const finding of findings) {
      expect(finding.category).toBe("host_fs_bind");
      expect(finding.field).toBe("volumes");
      expect(finding.description).toBe(
        "volume binds a sensitive host filesystem path or its ancestor",
      );
    }
  });

  it("flags long-syntax (type: bind) binds of Docker runtime/data paths and ancestors", () => {
    const source = [
      "services:",
      "  b:",
      "    image: x",
      "    volumes:",
      "      - source: /var/lib/docker",
      "        target: /docker",
      "        type: bind",
      "      - source: /run/containerd",
      "        target: /containerd",
      "        type: bind",
      "      - source: /var",
      "        target: /host-var",
      "        type: bind",
      "",
    ].join("\n");
    const findings = analyze(source);
    expect(findings.map((f) => f.service)).toEqual(["b", "b", "b"]);
    for (const finding of findings) {
      expect(finding.category).toBe("host_fs_bind");
      expect(finding.field).toBe("volumes");
    }
  });

  it("flags a descendant bind (/etc/passwd) as exposing the sensitive path", () => {
    const source = [
      "services:",
      "  c:",
      "    image: x",
      "    volumes:",
      '      - "/etc/passwd:/host-passwd"',
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "host_fs_bind",
        service: "c",
        field: "volumes",
        description: "volume binds a sensitive host filesystem path or its ancestor",
      },
    ]);
  });

  it("returns [] for benign relative app binds and non-sensitive absolute binds", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    volumes:",
      '      - "./app:/app"', // benign relative bind inside the project dir
      '      - "/opt/app:/app2"', // absolute but not a sensitive host path
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([]);
  });

  it("flags a relative source that climbs above the project directory", () => {
    const source = [
      "services:",
      "  d:",
      "    image: x",
      "    volumes:",
      '      - "../:/host-up"',
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "host_fs_bind",
        service: "d",
        field: "volumes",
        description: "volume binds a sensitive host filesystem path or its ancestor",
      },
    ]);
  });
});

describe("device passthrough and cgroup rules", () => {
  it("flags string and long-mapping device entries as passthrough", () => {
    const source = [
      "services:",
      "  gpu:",
      "    image: x",
      "    devices:",
      '      - "/dev/gpu0:/dev/gpu1"',
      "      - source: /dev/usb0",
      "        target: /dev/usb1",
      "",
    ].join("\n");
    const findings = analyze(source);
    expect(findings.map((f) => f.service)).toEqual(["gpu", "gpu"]);
    for (const finding of findings) {
      expect(finding.category).toBe("device_passthrough");
      expect(finding.field).toBe("devices");
      expect(finding.description).toBe("host device is passed through to the container");
    }
  });

  it("flags device_cgroup_rules as host cgroup access", () => {
    const source = [
      "services:",
      "  c:",
      "    image: x",
      "    device_cgroup_rules:",
      '      - "c 10:230 rwm"',
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "device_cgroup_rules",
        service: "c",
        field: "device_cgroup_rules",
        description: "host device cgroup rules grant container access to host devices",
      },
    ]);
  });

  it("rejects a non-sequence devices value and a bad device entry type", () => {
    expectRejected(
      ["services:", "  g:", "    image: x", "    devices: nope", ""].join("\n"),
      "devices must be a sequence of strings or mappings",
    );
    expectRejected(
      ["services:", "  g:", "    image: x", "    devices:", "      - 42", ""].join("\n"),
      "device entry must be a string or mapping",
    );
  });

  it("rejects interpolation in a device source and in cap_add", () => {
    expectRejected(
      [
        "services:",
        "  g:",
        "    image: x",
        "    devices:",
        "      - source: ${DEV}",
        "        target: /dev/x",
        "",
      ].join("\n"),
      "interpolation in checked field",
    );
    expectRejected(
      ["services:", "  g:", "    image: x", "    cap_add:", '      - "${CAP}"', ""].join(
        "\n",
      ),
      "interpolation in checked field",
    );
  });
});

describe("host uts and cgroup namespaces", () => {
  it("flags uts: host and cgroup: host with fixed descriptions", () => {
    const source = [
      "services:",
      "  d:",
      "    image: x",
      "    uts: host",
      "    cgroup: host",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "host_uts",
        service: "d",
        field: "uts",
        description: "uts is set to host namespace",
      },
      {
        category: "host_cgroup",
        service: "d",
        field: "cgroup",
        description: "cgroup is set to host namespace",
      },
    ]);
  });

  it("rejects a non-string uts value", () => {
    expectRejected(
      ["services:", "  d:", "    image: x", "    uts: 1234", ""].join("\n"),
      "uts must be a string",
    );
  });
});

describe("cap_add, security_opt, and volumes_from", () => {
  it("flags cap_add, security_opt, and volumes_from in field order", () => {
    const source = [
      "services:",
      "  e:",
      "    image: x",
      "    cap_add:",
      "      - NET_ADMIN",
      "    security_opt:",
      "      - apparmor=unconfined",
      "    volumes_from:",
      "      - other",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "cap_add",
        service: "e",
        field: "cap_add",
        description: "Linux capabilities are added to the container",
      },
      {
        category: "security_opt",
        service: "e",
        field: "security_opt",
        description: "container security options are relaxed",
      },
      {
        category: "volumes_from",
        service: "e",
        field: "volumes_from",
        description: "volume mounts are inherited from another container",
      },
    ]);
  });

  it("rejects non-sequence cap_add, security_opt, and volumes_from values", () => {
    expectRejected(
      ["services:", "  e:", "    image: x", "    cap_add: NET_ADMIN", ""].join("\n"),
      "cap_add must be a sequence of strings",
    );
    expectRejected(
      [
        "services:",
        "  e:",
        "    image: x",
        "    security_opt: apparmor=unconfined",
        "",
      ].join("\n"),
      "security_opt must be a sequence of strings",
    );
    expectRejected(
      ["services:", "  e:", "    image: x", "    volumes_from: other", ""].join("\n"),
      "volumes_from must be a sequence of strings",
    );
  });
});

describe("top-level named-volume driver_opts bind indirection", () => {
  it("flags a top-level volume whose driver_opts point at a bind source (explicit type)", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "volumes:",
      "  data:",
      "    driver: local",
      "    driver_opts:",
      "      type: bind",
      "      source: /var/lib/data",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "named_volume_bind",
        service: "data",
        field: "volumes",
        description: "top-level named volume uses a driver_opts bind source",
      },
    ]);
  });

  it("flags a top-level volume with a bare driver_opts source (no explicit type)", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "volumes:",
      "  data2:",
      "    driver_opts:",
      "      source: /var/lib/data2",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([
      {
        category: "named_volume_bind",
        service: "data2",
        field: "volumes",
        description: "top-level named volume uses a driver_opts bind source",
      },
    ]);
  });

  it("returns [] for top-level volumes without driver_opts (plain named volumes)", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "volumes:",
      "  clean:",
      "    driver: local",
      "",
    ].join("\n");
    expect(analyze(source)).toEqual([]);
  });

  it("rejects a non-mapping top-level volumes value and an ambiguous driver_opts type", () => {
    expectRejected(
      ["services:", "  w:", "    image: x", "volumes:", "  - data", ""].join("\n"),
      "top-level volumes must be a mapping",
    );
    expectRejected(
      [
        "services:",
        "  w:",
        "    image: x",
        "volumes:",
        "  d:",
        "    driver_opts:",
        "      type: tmpfs",
        "      source: /tmp/x",
        "",
      ].join("\n"),
      "ambiguous long mount type",
    );
  });

  it("rejects interpolation in a top-level volume driver_opts source", () => {
    expectRejected(
      [
        "services:",
        "  w:",
        "    image: x",
        "volumes:",
        "  d:",
        "    driver_opts:",
        "      type: bind",
        "      source: ${SRC}",
        "",
      ].join("\n"),
      "interpolation in checked field",
    );
  });
});

describe("volume source/target validation", () => {
  it("rejects an ambiguous long mount type (tmpfs)", () => {
    expectRejected(
      [
        "services:",
        "  w:",
        "    image: x",
        "    volumes:",
        "      - source: /data",
        "        target: /data",
        "        type: tmpfs",
        "",
      ].join("\n"),
      "ambiguous long mount type",
    );
  });

  it("rejects a long-syntax bind with no/empty source (invalid volume source)", () => {
    expectRejected(
      [
        "services:",
        "  w:",
        "    image: x",
        "    volumes:",
        "      - target: /data",
        "        type: bind",
        "",
      ].join("\n"),
      "invalid volume source",
    );
    expectRejected(
      ["services:", "  w:", "    image: x", "    volumes:", '      - ":/data"', ""].join(
        "\n",
      ),
      "invalid volume source",
    );
  });

  it("rejects a bind with no target (invalid volume target), long and short syntax", () => {
    expectRejected(
      [
        "services:",
        "  w:",
        "    image: x",
        "    volumes:",
        "      - source: /data",
        "        type: bind",
        "",
      ].join("\n"),
      "invalid volume target",
    );
    expectRejected(
      ["services:", "  w:", "    image: x", "    volumes:", '      - "/etc:"', ""].join(
        "\n",
      ),
      "invalid volume target",
    );
  });

  it("rejects a non-string/number volume entry (must be string or mapping)", () => {
    expectRejected(
      ["services:", "  w:", "    image: x", "    volumes:", "      - 42", ""].join("\n"),
      "volume entry must be a string or mapping",
    );
  });
});
