/**
 * HTTP transport tests: bearer authentication on /mcp, unauthenticated
 * rejection, the /health readiness probe, and a full authenticated MCP
 * request/response cycle over real HTTP (mocked ZimaOS services).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AppConfig } from "../src/config.js";
import { createHttpServer } from "../src/http/server.js";
import { PermissionLayer } from "../src/permissions.js";
import type { ToolDeps } from "../src/mcp/tools.js";

const MCP_TOKEN = "test-mcp-token-0123456789abcdef0123456789abcdef";

function makeConfig(): AppConfig {
  return {
    zimaosUrl: "http://zimaos.test",
    zimaosUsername: "admin",
    zimaosPassword: "pw",
    mcpAuthToken: MCP_TOKEN,
    allowAppControl: false,
    port: 0, // ephemeral in tests
    logLevel: "error",
  };
}

function makeDeps(): ToolDeps {
  return {
    apps: {
      listApps: async () => [{ id: "myapp", name: "My App", status: "running" }],
      getApp: async (id: string) => ({ id, name: "My App", status: "running" }),
      getAppHealth: async (id: string) => ({
        app: id,
        probe: { state: "healthy" },
        containers: [],
      }),
      getLogs: async () => "log-line-1\nlog-line-2",
      listContainers: async () => [],
      startApp: async () => undefined,
      stopApp: async () => undefined,
      restartApp: async () => undefined,
    } as unknown as ToolDeps["apps"],
    system: {
      getSystemInfo: async () => ({ hostname: "zima", osVersion: "v1.7.1" }),
    } as ToolDeps["system"],
    permissions: new PermissionLayer({ allowAppControl: false }),
  };
}

interface RunningServer {
  server: http.Server;
  baseUrl: string;
  setReady: (value: boolean) => void;
}

async function startServer(): Promise<RunningServer> {
  const state = { ready: true };
  const server = createHttpServer({
    config: makeConfig(),
    deps: makeDeps(),
    isReady: () => state.ready,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    setReady: (value: boolean) => {
      state.ready = value;
    },
  };
}

describe("HTTP transport (mocked services)", () => {
  let running: RunningServer;

  beforeAll(async () => {
    running = await startServer();
  });

  afterAll(async () => {
    if (running) {
      await new Promise<void>((resolve) => running.server.close(() => resolve()));
    }
  });

  it("rejects /mcp requests without a bearer token (401)", async () => {
    const res = await fetch(`${running.baseUrl}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects /mcp requests with the wrong token (401)", async () => {
    const res = await fetch(`${running.baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${"wrong".repeat(20)}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects /mcp requests with a malformed Authorization header (401)", async () => {
    const res = await fetch(`${running.baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: MCP_TOKEN }, // missing "Bearer" scheme
    });
    expect(res.status).toBe(401);
  });

  it("serves /health without authentication and reflects readiness", async () => {
    const res = await fetch(`${running.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; ready: boolean };
    expect(body.ready).toBe(true);
    expect(body.status).toBe("ok");

    // Flip readiness and confirm the probe degrades.
    running.setReady(false);
    const degraded = await fetch(`${running.baseUrl}/health`);
    const body2 = (await degraded.json()) as { status: string; ready: boolean };
    expect(body2.ready).toBe(false);
    expect(body2.status).toBe("degraded");
    running.setReady(true);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`${running.baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("completes an authenticated MCP initialize + tools/list over HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("/mcp", running.baseUrl),
      {
        requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
      },
    );
    const client = new Client({ name: "http-test-client", version: "0.0.1" });
    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toContain("list_apps");

      const result = await client.callTool({ name: "get_system_info", arguments: {} });
      expect(result.isError).toBeFalsy();
    } finally {
      await transport.close();
    }
  });
});
