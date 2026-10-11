import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/mcp/tools.js";
import { PermissionLayer } from "../src/permissions.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { SystemService } from "../src/zimaos/systemService.js";
import { AppService } from "../src/zimaos/appService.js";

async function harness(enabled = false) {
  const calls: string[] = [];
  const api = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "test",
    password: "synthetic-password",
    fetchImpl: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(`${init?.method} ${path}`);
      if (path === "/v1/users/login")
        return Response.json({
          success: true,
          data: { token: { access_token: "synthetic-token" } },
        });
      return Response.json({
        success: 200,
        data: "The operation will be completed shortly.",
      });
    }) as typeof fetch,
  });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    apps: new AppService(api),
    system: new SystemService(api),
    permissions: new PermissionLayer({
      allowAppControl: true,
      allowAppInstall: true,
      allowAppEdit: true,
      allowAppUninstall: true,
      allowSystemControl: enabled,
    }),
  });
  await server.connect(remote);
  const client = new Client({ name: "restart-test", version: "0.0.1" });
  await client.connect(local);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("restart_device wire boundary", () => {
  it("advertises a strict disruptive non-idempotent tool and rejects extra inputs before I/O", async () => {
    const h = await harness(true);
    try {
      const { tools } = await h.client.listTools();
      expect(tools).toHaveLength(21);
      expect(tools.find((t) => t.name === "restart_device")).toMatchObject({
        inputSchema: { type: "object", additionalProperties: false },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      });
      for (const arguments_ of [
        { state: "off" },
        { force: true },
        { url: "http://other.test" },
        { retry: true },
      ]) {
        expect(
          (await h.client.callTool({ name: "restart_device", arguments: arguments_ }))
            .isError,
        ).toBe(true);
      }
      expect(h.calls).toEqual([]);
      const result = await h.client.callTool({ name: "restart_device", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({
            status: "accepted",
            accepted: true,
            completion: "unverified",
            retrySafe: false,
          }),
        },
      ]);
      expect(h.calls).toEqual(["POST /v1/users/login", "PUT /v1/sys/state/restart"]);
    } finally {
      await h.close();
    }
  });
  it("denies by default before login or mutation despite all app grants", async () => {
    const h = await harness();
    try {
      const result = await h.client.callTool({ name: "restart_device", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: "[SYSTEM_CONTROL_DISABLED] Device restart is disabled. Set ALLOW_SYSTEM_CONTROL=true to enable it.",
        },
      ]);
      expect(h.calls).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
