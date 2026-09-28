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
  it("exposes the Phase 1 tool set", async () => {
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
