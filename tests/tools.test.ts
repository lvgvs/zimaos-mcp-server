/**
 * MCP tool-layer tests: drive a real McpServer over an in-memory transport,
 * with mocked ZimaOS services. Verifies the read/control separation, input
 * validation, bounded log output, and normalized error results (no stack
 * traces) as seen by an MCP client.
 */

import { describe, expect, it } from "vitest";
import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { AppError } from "../src/errors.js";
import { PermissionLayer } from "../src/permissions.js";
import { createMcpServer, type ToolDeps } from "../src/mcp/tools.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const BASE = "http://zimaos.test:8080";
/** The fake records pathname only; routes key on the bare path. */
const DRY_RUN_PATH = "/v2/app_management/compose";

interface Harness {
  client: Client;
  serverTransport: InMemoryTransport;
}

async function connect(deps: ToolDeps): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createMcpServer(deps);
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, serverTransport };
}

type ToolOutcome = { content?: CallToolResult["content"]; toolResult?: unknown };

function textOf(result: ToolOutcome): string {
  const first = result.content?.[0];
  if (!first || first.type !== "text") throw new Error("expected text content");
  return first.text;
}

/** Build ToolDeps backed by a fake ZimaOS client (no network). */
function makeDeps(overrides: { allowAppControl?: boolean } = {}): ToolDeps {
  const apps: Record<string, unknown> = {};
  const deps: ToolDeps = {
    apps: {
      listApps: async () => [{ id: "myapp", name: "My App", status: "running" }],
      getApp: async (id: string) => ({ id, name: "My App", status: "running" }),
      getAppHealth: async (id: string) => ({
        app: id,
        probe: { state: "healthy" },
        containers: [],
      }),
      getLogs: async (_id: string, lines: number) =>
        `line-1\nline-2 (${lines} requested)`,
      listContainers: async () => [],
      startApp: async (id: string) => {
        apps["start"] = id;
      },
      stopApp: async (id: string) => {
        apps["stop"] = id;
      },
      restartApp: async (id: string) => {
        apps["restart"] = id;
      },
    } as unknown as ToolDeps["apps"],
    system: {
      getSystemInfo: async () => ({ hostname: "zima", osVersion: "v1.7.1" }),
    } as unknown as ToolDeps["system"],
    permissions: new PermissionLayer({
      allowAppControl: overrides.allowAppControl ?? false,
    }),
  };
  return deps;
}

describe("MCP tools (mocked services)", () => {
  it("exposes the Phase 1 tool set alongside validate_app_compose", async () => {
    const { client, serverTransport } = await connect(makeDeps());
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "get_app",
          "get_app_health",
          "get_app_logs",
          "get_system_info",
          "install_app_from_compose",
          "list_app_containers",
          "list_apps",
          "restart_app",
          "start_app",
          "stop_app",
          "uninstall_app",
          "validate_app_compose",
        ].sort(),
      );
    } finally {
      await serverTransport.close();
    }
  });

  it("read tools work without app control enabled", async () => {
    const { client, serverTransport } = await connect(makeDeps());
    try {
      const result = await client.callTool({ name: "list_apps", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("myapp");

      const sysInfo = await client.callTool({ name: "get_system_info", arguments: {} });
      expect(sysInfo.isError).toBeFalsy();
      expect(textOf(sysInfo)).toContain("zima");
    } finally {
      await serverTransport.close();
    }
  });

  it("control tools are denied by default with a clear, non-leaky error", async () => {
    const { client, serverTransport } = await connect(makeDeps());
    try {
      const result = await client.callTool({
        name: "start_app",
        arguments: { app_id: "myapp" },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("APP_CONTROL_DISABLED");
      // The error must not leak stack traces or internal paths.
      expect(text).not.toMatch(/at\s+\w+.*\(.+:\d+:\d+/);
    } finally {
      await serverTransport.close();
    }
  });

  it("control tools succeed when ALLOW_APP_CONTROL is enabled", async () => {
    const deps = makeDeps({ allowAppControl: true });
    const { client, serverTransport } = await connect(deps);
    try {
      const result = await client.callTool({
        name: "start_app",
        arguments: { app_id: "myapp" },
      });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("myapp");
    } finally {
      await serverTransport.close();
    }
  });

  it("rejects invalid tool input (missing app_id) without calling services", async () => {
    const { client, serverTransport } = await connect(makeDeps());
    try {
      // Zod schema rejects before the handler runs; SDK surfaces a tool error.
      const result = await client.callTool({ name: "get_app", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await serverTransport.close();
    }
  });

  it("bounds log output to the requested line count (max 500)", async () => {
    const deps = makeDeps();
    const { client, serverTransport } = await connect(deps);
    try {
      // Requesting more than the cap is rejected by the schema.
      const tooMany = await client.callTool({
        name: "get_app_logs",
        arguments: { app_id: "myapp", lines: 10_000 },
      });
      expect(tooMany.isError).toBe(true);

      // A valid request passes the line count through to the service.
      const ok = await client.callTool({
        name: "get_app_logs",
        arguments: { app_id: "myapp", lines: 42 },
      });
      expect(ok.isError).toBeFalsy();
      expect(textOf(ok)).toContain("42 requested");
    } finally {
      await serverTransport.close();
    }
  });

  it("normalizes upstream AppErrors into MCP error results without stack traces", async () => {
    const deps = makeDeps();
    // Simulate an upstream failure from the service layer.
    (deps.apps as unknown as Record<string, unknown>).getApp = async (_id: string) => {
      throw new AppError(
        "ZIMAOS_NOT_FOUND",
        "The requested resource was not found on the ZimaOS host.",
      );
    };
    const { client, serverTransport } = await connect(deps);
    try {
      const result = await client.callTool({
        name: "get_app",
        arguments: { app_id: "nope" },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("ZIMAOS_NOT_FOUND");
      // No internal stack trace or file paths leak to the client.
      expect(text).not.toMatch(/\bat\s+\S+.*\(.+:\d+:\d+/);
    } finally {
      await serverTransport.close();
    }
  });
});

/**
 * Focused tests for the read-only `validate_app_compose` MCP tool, driven over
 * an in-memory transport with a real AppService backed by a fake ZimaOS HTTP
 * endpoint (no network). Verifies: safe unnamed documents succeed; risky
 * findings are disclosed as data; invalid sources fail locally without any
 * upstream call; ambiguous upstream statuses are preserved as data; and the
 * tool is accessible with app control disabled.
 */

interface ValidateHarness {
  client: Client;
  serverTransport: InMemoryTransport;
  fake: FakeZimaOs;
}

/** Connect an MCP client to a server whose AppService talks to a fake ZimaOS. */
async function connectValidate(
  overrides: { allowAppControl?: boolean } = {},
): Promise<ValidateHarness> {
  const fake = new FakeZimaOs();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) =>
    fake.fetchImpl(input, init)) as typeof fetch;
  const zimaClient = new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl,
    timeoutMs: 5_000,
  });
  const deps: ToolDeps = {
    apps: new AppService(zimaClient),
    system: {
      getSystemInfo: async () => ({ hostname: "zima", osVersion: "v1.7.1" }),
    } as unknown as ToolDeps["system"],
    permissions: new PermissionLayer({
      allowAppControl: overrides.allowAppControl ?? false,
    }),
  };
  const harness = await connect(deps);
  return { ...harness, fake };
}

function loginOk(fake: FakeZimaOs): void {
  fake.on("POST", "/v1/users/login", {
    json: {
      success: true,
      message: "ok",
      data: { token: { access_token: "tok-abc", refresh_token: "ref" } },
    },
  });
}

function dryRunCalls(fake: FakeZimaOs) {
  return fake.calls.filter((c) => c.path === DRY_RUN_PATH);
}

describe("validate_app_compose (in-memory MCP)", () => {
  it("validates a safe unnamed document and returns structured success", async () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:alpine",
      "    ports:",
      '      - "8080:80"',
      "",
    ].join("\n");
    const h = await connectValidate();
    try {
      loginOk(h.fake);
      h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

      const result = await h.client.callTool({
        name: "validate_app_compose",
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result)) as Record<string, unknown>;
      // No top-level `name` is required for validation.
      expect(parsed["status"]).toBe("accepted");
      expect(parsed["accepted"]).toBe(true);
      expect(parsed["findings"]).toEqual([]);

      // The exact original source reaches the dry run unchanged, exactly once.
      const calls = dryRunCalls(h.fake);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toBe(source);
      // Read-only: only login and the dry run are ever called (no mutation).
      expect([...new Set(h.fake.calls.map((c) => c.path))].sort()).toEqual(
        ["/v1/users/login", DRY_RUN_PATH].sort(),
      );
    } finally {
      await h.serverTransport.close();
    }
  });

  it("discloses risky findings in the structured result", async () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    privileged: true",
      "    network_mode: host",
      "    volumes:",
      '      - "/var/run/docker.sock:/docker"',
      "",
    ].join("\n");
    const h = await connectValidate();
    try {
      loginOk(h.fake);
      h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

      const result = await h.client.callTool({
        name: "validate_app_compose",
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result)) as {
        status: string;
        findings: Array<Record<string, unknown>>;
      };
      // Findings are data (disclosure), not an error.
      expect(parsed.status).toBe("accepted");
      expect(parsed.findings.map((f) => f["category"])).toEqual([
        "privileged",
        "host_network_mode",
        "docker_socket",
      ]);
      for (const finding of parsed.findings) {
        expect(finding["service"]).toBe("web");
        expect(typeof finding["field"]).toBe("string");
        expect(typeof finding["description"]).toBe("string");
      }
    } finally {
      await h.serverTransport.close();
    }
  });

  it("handles an invalid source as a normalized error without any upstream call", async () => {
    const h = await connectValidate();
    try {
      loginOk(h.fake); // registered but must never be consumed

      const result = await h.client.callTool({
        name: "validate_app_compose",
        arguments: { source: "services:\n  web: [unclosed\n" },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      // Normalized, safe error: no raw input echo, no stack trace.
      expect(text).toContain("INPUT_INVALID");
      expect(text).not.toMatch(/\bat\s+\S+.*\(.+:\d+:\d+/);
      // Local rejection short-circuits before any upstream call (no login).
      expect(h.fake.calls).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("preserves an ambiguous upstream status as data, not an error", async () => {
    const source = "services:\n  web:\n    image: nginx\n";
    const h = await connectValidate();
    try {
      loginOk(h.fake);
      h.fake.on("POST", DRY_RUN_PATH, { status: 502, text: "SECRET-UPSTREAM-TEXT" });

      const result = await h.client.callTool({
        name: "validate_app_compose",
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result)) as Record<string, unknown>;
      // Ambiguity is preserved for the caller; it does not mean invalid.
      expect(parsed["status"]).toBe("upstream_error");
      expect(parsed["accepted"]).toBe(false);
      expect(textOf(result)).not.toContain("SECRET-UPSTREAM-TEXT");
    } finally {
      await h.serverTransport.close();
    }
  });

  it("is accessible with app control disabled (read-only, no permission flag)", async () => {
    const source = "services:\n  web:\n    image: nginx\n";
    // allowAppControl defaults to false here.
    const h = await connectValidate();
    try {
      loginOk(h.fake);
      h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

      const result = await h.client.callTool({
        name: "validate_app_compose",
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).not.toContain("APP_CONTROL_DISABLED");
    } finally {
      await h.serverTransport.close();
    }
  });
});

/**
 * Focused tests for the mutating `install_app_from_compose` MCP tool, driven
 * over an in-memory transport with a real AppService backed by a fake ZimaOS
 * HTTP endpoint (no network). Verifies: default-off ALLOW_APP_INSTALL denies
 * with zero upstream traffic; a benign document performs exactly one dry run
 * and one real install POST carrying the exact original source; a risky
 * document returns confirmation_required data WITHOUT any mutation; accepted /
 * rejected / upstream_error outcomes are fixed-shape data (not errors);
 * duplicate identities fail closed without an install POST; invalid input is
 * normalized locally with no source echo.
 */

const COMPOSE_PATH = "/v2/app_management/compose";
/** Full real-install URL suffix the client must call exactly once. */
const INSTALL_URL_SUFFIX = "dry_run=false&check_port_conflict=true";
/** Dry-run URL suffix (preflight only; never an install). */
const DRY_RUN_URL_SUFFIX = "dry_run=true&check_port_conflict=true";

interface InstallHarness {
  client: Client;
  serverTransport: InMemoryTransport;
  fake: FakeZimaOs;
  /** Every full request URL sent by the client, in order. */
  urls: string[];
}

/** Connect an MCP client to a server whose AppService talks to a fake ZimaOS. */
async function connectInstall(
  overrides: { allowAppControl?: boolean; allowAppInstall?: boolean } = {},
): Promise<InstallHarness> {
  const fake = new FakeZimaOs();
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return fake.fetchImpl(input, init);
  }) as typeof fetch;
  const zimaClient = new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl,
    timeoutMs: 5_000,
  });
  const deps: ToolDeps = {
    apps: new AppService(zimaClient),
    system: {
      getSystemInfo: async () => ({ hostname: "zima", osVersion: "v1.7.1" }),
    } as unknown as ToolDeps["system"],
    permissions: new PermissionLayer({
      allowAppControl: overrides.allowAppControl ?? false,
      allowAppInstall: overrides.allowAppInstall ?? false,
    }),
  };
  const harness = await connect(deps);
  return { ...harness, fake, urls };
}

function listOk(fake: FakeZimaOs, apps: Array<{ id: string; name?: string }>): void {
  const data: Record<string, unknown> = {};
  for (const app of apps) {
    data[app.id] = { name: app.name ?? app.id };
  }
  fake.ok("GET", COMPOSE_PATH, data);
}

/**
 * Register the two POST responses consumed in order on the compose pathname:
 * first the dry run (preflight), then the real install attempt. The fake
 * consumes one spec per call for a key, so order matches request order.
 */
function dryRunThenInstall(
  fake: FakeZimaOs,
  installSpec: { status?: number; json?: unknown; text?: string },
): void {
  fake.on("POST", COMPOSE_PATH, { json: { success: true } }); // preflight dry run
  fake.on("POST", COMPOSE_PATH, installSpec); // real install attempt
}

function composePosts(fake: FakeZimaOs) {
  return fake.calls.filter((c) => c.method === "POST" && c.path === COMPOSE_PATH);
}

describe("install_app_from_compose (in-memory MCP)", () => {
  it("is denied by default with zero upstream traffic", async () => {
    // Both permission flags default off; no routes registered at all, so any
    // upstream call would throw.
    const h = await connectInstall();
    try {
      const result = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: {
          source: "name: mcp-denied-01\nservices:\n  web:\n    image: nginx\n",
        },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("APP_INSTALL_DISABLED");
      // Zero upstream traffic: no login, no list read, no dry run, no install.
      expect(h.fake.calls).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("installs a benign document with exactly one dry run and one real POST", async () => {
    const source = [
      "name: mcp-benign-01",
      "services:",
      "  web:",
      '    image: "nginx:alpine"',
      "",
    ].join("\n");
    const h = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h.fake);
      listOk(h.fake, []);
      dryRunThenInstall(h.fake, { status: 200, json: { success: true } });

      const result = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      // Fixed-shape asynchronous acceptance data — not claimed completion.
      expect(JSON.parse(textOf(result))).toEqual({ status: "accepted", accepted: true });

      // Exactly one dry run and exactly one real install POST...
      expect(h.urls.filter((u) => u.includes(DRY_RUN_URL_SUFFIX))).toHaveLength(1);
      const installs = h.urls.filter((u) => u.includes(INSTALL_URL_SUFFIX));
      expect(installs).toHaveLength(1);
      // ...carrying the exact original source unchanged as YAML.
      expect(composePosts(h.fake)).toHaveLength(2);
      const installCall = h.fake.calls.find(
        (c) => c.method === "POST" && c.path === COMPOSE_PATH && c.body === source,
      );
      expect(installCall?.body).toBe(source);
      // One login for the whole flow; no re-login or retry.
      expect(h.fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("returns confirmation_required data for a risky document without any install", async () => {
    const source = [
      "name: mcp-risky-01",
      "services:",
      "  web:",
      "    image: nginx",
      "    privileged: true",
      "",
    ].join("\n");
    const h = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h.fake);
      listOk(h.fake, []);
      // Only the dry-run route is registered; an install attempt would throw.
      h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });

      const result = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source },
      });
      // Findings are data (disclosure), not an error.
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(textOf(result)) as {
        status: string;
        name?: string;
        findings?: Array<Record<string, unknown>>;
      };
      expect(parsed.status).toBe("confirmation_required");
      expect(parsed.name).toBe("mcp-risky-01");
      expect((parsed.findings ?? []).map((f) => f["category"])).toEqual(["privileged"]);

      // No mutation on the confirmation path: one dry run, zero install POSTs.
      expect(h.urls.filter((u) => u.includes(DRY_RUN_URL_SUFFIX))).toHaveLength(1);
      expect(h.urls.filter((u) => u.includes(INSTALL_URL_SUFFIX))).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("returns rejected and upstream_error outcomes as fixed-shape data", async () => {
    // Definitive host rejection after exactly one POST.
    const rejectedSource = "name: mcp-rejected-01\nservices:\n  web:\n    image: nginx\n";
    const h1 = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h1.fake);
      listOk(h1.fake, []);
      dryRunThenInstall(h1.fake, { status: 200, json: { success: false } });

      const r1 = await h1.client.callTool({
        name: "install_app_from_compose",
        arguments: { source: rejectedSource },
      });
      expect(r1.isError).toBeFalsy();
      expect(JSON.parse(textOf(r1))).toEqual({ status: "rejected", accepted: false });
      // The single attempt was made exactly once; no retry.
      expect(h1.urls.filter((u) => u.includes(INSTALL_URL_SUFFIX))).toHaveLength(1);
    } finally {
      await h1.serverTransport.close();
    }

    // Ambiguous 502 after the single attempt: data, not an error, no echo.
    const upstreamSource = "name: mcp-upstream-01\nservices:\n  web:\n    image: nginx\n";
    const h2 = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h2.fake);
      listOk(h2.fake, []);
      dryRunThenInstall(h2.fake, { status: 502, text: "SECRET-UPSTREAM-TEXT" });

      const r2 = await h2.client.callTool({
        name: "install_app_from_compose",
        arguments: { source: upstreamSource },
      });
      expect(r2.isError).toBeFalsy();
      expect(JSON.parse(textOf(r2))).toEqual({
        status: "upstream_error",
        accepted: false,
      });
      expect(h2.urls.filter((u) => u.includes(INSTALL_URL_SUFFIX))).toHaveLength(1);
      // Upstream free-form text is never relayed to the client.
      expect(textOf(r2)).not.toContain("SECRET-UPSTREAM-TEXT");
    } finally {
      await h2.serverTransport.close();
    }
  });

  it("fails closed on a duplicate identity without any install POST", async () => {
    const source = "name: mcp-dup-01\nservices:\n  web:\n    image: nginx\n";
    const h = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h.fake);
      listOk(h.fake, [{ id: "mcp-dup-01" }]);

      const result = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("ZIMAOS_BAD_REQUEST");
      // Duplicate detected from the single list read; no dry run, no install.
      expect(
        h.fake.calls.filter((c) => c.method === "GET" && c.path === COMPOSE_PATH),
      ).toHaveLength(1);
      expect(h.urls.filter((u) => u.includes(INSTALL_URL_SUFFIX))).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("rejects invalid input without any upstream call", async () => {
    const h = await connectInstall({ allowAppInstall: true });
    try {
      loginOk(h.fake); // registered but must never be consumed

      // Schema-level: an empty source is rejected before the handler runs.
      const empty = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source: "" },
      });
      expect(empty.isError).toBe(true);

      // UTF-8 bytes, not JavaScript string length, define the parser budget.
      const oversized = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source: "é".repeat(300_000) },
      });
      expect(oversized.isError).toBe(true);

      // Service-level: unparseable YAML fails locally with a normalized, safe
      // error — no raw input echo, no stack trace.
      const badSource =
        "name: mcp-bad-01\nservices:\n  web: [unclosed #SECRET-YAML-MARKER-XYZ\n";
      const invalid = await h.client.callTool({
        name: "install_app_from_compose",
        arguments: { source: badSource },
      });
      expect(invalid.isError).toBe(true);
      const text = textOf(invalid);
      expect(text).toContain("INPUT_INVALID");
      expect(text).not.toContain("SECRET-YAML-MARKER-XYZ");
      expect(text).not.toMatch(/\bat\s+\S+.*\(.+:\d+:\d+/);

      // Local rejections short-circuit before any upstream call (no login).
      expect(h.fake.calls).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });
});
