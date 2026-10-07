/**
 * HTTP transport tests: bearer authentication on /mcp, unauthenticated
 * rejection, the /health readiness probe, and a full authenticated MCP
 * request/response cycle over real HTTP (mocked ZimaOS services).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "../src/logging.js";
import http from "node:http";
import crypto from "node:crypto";
import { Socket, type AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AppConfig } from "../src/config.js";
import { createHttpServer } from "../src/http/server.js";
import { PermissionLayer } from "../src/permissions.js";
import type { ToolDeps } from "../src/mcp/tools.js";
import type * as McpNode from "@modelcontextprotocol/node";

vi.mock("@modelcontextprotocol/node", async (importOriginal) => {
  const actual = await importOriginal<typeof McpNode>();
  return {
    ...actual,
    toNodeHandler: (...args: Parameters<typeof actual.toNodeHandler>) => {
      const handler = actual.toNodeHandler(...args);
      return async (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.headers["x-test-transport-failure"] === "1") {
          throw new Error("SYNTHETIC_SECRET");
        }
        return handler(req, res);
      };
    },
  };
});

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

async function startServer(
  probe?: () => boolean | Promise<boolean>,
): Promise<RunningServer> {
  const state = { ready: true };
  const server = createHttpServer({
    config: makeConfig(),
    deps: makeDeps(),
    isReady: probe ?? (() => state.ready),
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

  it.each([
    ["empty header", ""],
    ["scheme only", "Bearer"],
    ["whitespace-only credentials", "Bearer \t "],
    ["wrong scheme", `Basic ${MCP_TOKEN}`],
    ["missing separator", `Bearer${MCP_TOKEN}`],
    ["colon separator", `Bearer: ${MCP_TOKEN}`],
    ["duplicate credentials", `Bearer ${MCP_TOKEN}, Bearer ${MCP_TOKEN}`],
    ["embedded carriage return", `Bearer ${MCP_TOKEN}\rx`],
    ["embedded newline", `Bearer ${MCP_TOKEN}\nx`],
    ["embedded Unicode line separator", `Bearer ${MCP_TOKEN}\u2028x`],
    ["embedded Unicode paragraph separator", `Bearer ${MCP_TOKEN}\u2029x`],
  ])("rejects malformed bearer syntax: %s", (_label, authorization) => {
    // Direct boundary injection also covers characters rejected by Node's wire parser.
    const req = new http.IncomingMessage(new Socket());
    req.method = "POST";
    req.url = "/mcp";
    req.headers.authorization = authorization;
    const res = new http.ServerResponse(req);
    try {
      running.server.emit("request", req, res);
      expect(res.statusCode).toBe(401);
      expect(res.getHeader("www-authenticate")).toBe('Bearer realm="zimaos-mcp-server"');
    } finally {
      req.destroy();
      res.destroy();
    }
  });

  it.each([
    ["long spaces before malformed credential", `Bearer${" ".repeat(60_000)}x\rx`],
    ["long tabs before malformed credential", `Bearer${"\t".repeat(60_000)}x\nx`],
    ["long empty credential", `Bearer${" ".repeat(1_000_000)}`],
    ["long wrong credential", `Bearer ${"x".repeat(1_000_000)}`],
    ["long missing separator", `Bearer${"x".repeat(1_000_000)}`],
  ])("rejects long attacker-controlled Authorization: %s", (_label, authorization) => {
    // Inject at the auth boundary so Node's wire-header cap/validation cannot hide ReDoS.
    const req = new http.IncomingMessage(new Socket());
    req.method = "POST";
    req.url = "/mcp";
    req.headers.authorization = authorization;
    const res = new http.ServerResponse(req);
    try {
      const start = performance.now();
      running.server.emit("request", req, res);
      expect(res.statusCode).toBe(401);
      // A generous regression ceiling, not the basis of the linear-complexity claim.
      expect(performance.now() - start).toBeLessThan(1_000);
    } finally {
      req.destroy();
      res.destroy();
    }
  });

  it.each([
    ["lowercase scheme", `bearer ${MCP_TOKEN}`],
    ["mixed-case scheme", `bEaReR ${MCP_TOKEN}`],
    ["multiple spaces", `Bearer   ${MCP_TOKEN}`],
    ["tab separator", `Bearer\t${MCP_TOKEN}`],
    ["mixed separator whitespace", `Bearer \t ${MCP_TOKEN}`],
    ["Latin-1 whitespace separator", `Bearer\u00a0${MCP_TOKEN}`],
    ["outer whitespace", ` \tBearer ${MCP_TOKEN} \t`],
    ["long separator", `Bearer${" ".repeat(8_000)}${MCP_TOKEN}`],
  ])(
    "authenticates supported bearer syntax over real HTTP: %s",
    async (_label, authorization) => {
      const transport = new StreamableHTTPClientTransport(
        new URL("/mcp", running.baseUrl),
        {
          requestInit: { headers: { authorization } },
        },
      );
      const client = new Client({ name: "bearer-syntax-test", version: "0.0.1" });
      try {
        await client.connect(transport);
        expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
          "list_apps",
        );
      } finally {
        await transport.close();
      }
    },
  );

  it.each([
    ["equal length", "x".repeat(MCP_TOKEN.length)],
    ["different length", "wrong-token"],
  ])(
    "retains timing-safe comparison for wrong credentials: %s",
    async (_label, token) => {
      const compare = vi.spyOn(crypto, "timingSafeEqual");
      try {
        const res = await fetch(`${running.baseUrl}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(401);
        expect(compare).toHaveBeenCalledExactlyOnceWith(
          Buffer.from(token, "utf8"),
          token.length === MCP_TOKEN.length
            ? Buffer.from(MCP_TOKEN, "utf8")
            : Buffer.alloc(Buffer.byteLength(token, "utf8")),
        );
      } finally {
        compare.mockRestore();
      }
    },
  );

  it("serves /health without authentication and reflects readiness", async () => {
    const res = await fetch(`${running.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; ready: boolean };
    expect(body.ready).toBe(true);
    expect(body.status).toBe("ok");

    // Flip readiness and confirm the probe degrades.
    running.setReady(false);
    const degraded = await fetch(`${running.baseUrl}/health`);
    expect(degraded.status).toBe(503);
    const body2 = (await degraded.json()) as { status: string; ready: boolean };
    expect(body2.ready).toBe(false);
    expect(body2.status).toBe("degraded");
    running.setReady(true);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`${running.baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("does not log secret-bearing unexpected transport errors", async () => {
    const logged = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const res = await fetch(`${running.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MCP_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "x-test-transport-failure": "1",
        },
        body: "SYNTHETIC_SECRET",
      });
      expect(res.ok).toBe(false);
      expect(logged).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain("SYNTHETIC_SECRET");
    } finally {
      logged.mockRestore();
    }
  });

  it("awaits an asynchronous readiness failure", async () => {
    const isolated = await startServer(async () => false);
    try {
      const res = await fetch(`${isolated.baseUrl}/health`);
      expect(res.status).toBe(503);
      expect((await res.json()) as { ready: boolean }).toMatchObject({ ready: false });
    } finally {
      await new Promise<void>((resolve) => isolated.server.close(() => resolve()));
    }
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

  it("negotiates the modern 2026-07-28 protocol when pinned", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("/mcp", running.baseUrl),
      {
        requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
      },
    );
    const client = new Client(
      { name: "modern-pinned-client", version: "0.0.1" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
      },
    );
    await client.connect(transport);

    try {
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toContain("list_apps");
    } finally {
      await transport.close();
    }
  });

  it("serves legacy stateless clients (default negotiation)", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("/mcp", running.baseUrl),
      {
        requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
      },
    );
    // Default client (no versionNegotiation) speaks the plain 2025 sequence;
    // the server answers it via its stateless legacy leg.
    const client = new Client({ name: "legacy-client", version: "0.0.1" });
    await client.connect(transport);

    try {
      expect(client.getProtocolEra()).toBe("legacy");

      const result = await client.callTool({ name: "get_system_info", arguments: {} });
      expect(result.isError).toBeFalsy();
    } finally {
      await transport.close();
    }
  });

  it("rejects MCP request bodies over 1 MiB with 413", async () => {
    const pad = "x".repeat(1_200_000); // pushes the JSON body past 1 MiB
    const res = await fetch(`${running.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${MCP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_system_info", arguments: { pad } },
      }),
    });
    expect(res.status).toBe(413);
  });
});
