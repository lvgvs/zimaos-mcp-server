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
          "list_app_containers",
          "list_apps",
          "restart_app",
          "start_app",
          "stop_app",
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
