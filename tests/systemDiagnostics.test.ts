import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/mcp/tools.js";
import { PermissionLayer } from "../src/permissions.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { SystemService } from "../src/zimaos/systemService.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

function api(fake: FakeZimaOs) {
  fake.ok("POST", "/v1/users/login", { token: { access_token: "test-token" } });
  return new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "test",
    password: "test-password",
    fetchImpl: fake.fetchImpl,
  });
}

describe("system diagnostics through MCP", () => {
  it("advertises exactly two new read-only tools and rejects extra arguments before I/O", async () => {
    const fake = new FakeZimaOs();
    const upstream = api(fake);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await createMcpServer({
      apps: new AppService(upstream),
      system: new SystemService(upstream),
      permissions: new PermissionLayer({ allowAppControl: false }),
    }).connect(st);
    const client = new Client({ name: "diagnostics-test", version: "0.0.0" });
    await client.connect(ct);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(20);
      for (const name of ["get_system_resources", "get_os_update_status"]) {
        expect(tools.find((t) => t.name === name)).toMatchObject({
          annotations: { readOnlyHint: true, destructiveHint: false },
          inputSchema: { additionalProperties: false },
        });
        for (const args of [
          { force: true },
          { refresh: true },
          { url: "http://external.test" },
        ]) {
          expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
        }
      }
      expect(fake.calls).toEqual([]);
    } finally {
      await client.close();
      await st.close();
    }
  });
  it("reports OS availability from notice and installer state, not version inequality", async () => {
    const fake = new FakeZimaOs()
      .raw("GET", "/v2/installer/release/current", {
        data: { version: "1.7.1", release_note: "secret" },
      })
      .raw("GET", "/v2/installer/release/latest", { data: { version: "1.8.0" } })
      .raw("GET", "/v2/installer/web/notice", { data: "no-update" })
      .raw("GET", "/v2/installer/status", {
        data: { status: "idle" },
        message: "credential",
      })
      .raw("GET", "/v2/installer/beta-subscription", { data: { status: "disabled" } });
    const upstream = api(fake);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      apps: new AppService(upstream),
      system: new SystemService(upstream),
      permissions: new PermissionLayer({ allowAppControl: false }),
    });
    await server.connect(st);
    const client = new Client({ name: "diagnostics-test", version: "0.0.0" });
    await client.connect(ct);
    try {
      const result = await client.callTool({
        name: "get_os_update_status",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      const first = result.content?.[0];
      if (first?.type !== "text") throw new Error("Expected text");
      expect(JSON.parse(first.text)).toEqual({
        currentVersion: "1.7.1",
        latestVersion: "1.8.0",
        notice: "no-update",
        updateAvailable: false,
        installerStatus: "idle",
        betaSubscription: "disabled",
      });
      expect(fake.calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual([
        "/v1/users/login",
      ]);
    } finally {
      await client.close();
      await st.close();
    }
  });
  it("projects resources through authenticated GET with controls disabled", async () => {
    const fake = new FakeZimaOs().raw("GET", "/v1/sys/utilization", {
      success: 200,
      data: {
        cpu: { percent: 12, num: 2, temperature: 0 },
        mem: { total: 100, used: 40 },
        sys_disk: { size: 1000, used: 100, avail: 800, health: true },
        net: { secret: "not-public" },
      },
    });
    const upstream = api(fake);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      apps: new AppService(upstream),
      system: new SystemService(upstream),
      permissions: new PermissionLayer({ allowAppControl: false }),
    });
    await server.connect(st);
    const client = new Client({ name: "diagnostics-test", version: "0.0.0" });
    await client.connect(ct);
    try {
      const result = await client.callTool({
        name: "get_system_resources",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      const first = result.content?.[0];
      expect(first?.type).toBe("text");
      if (first?.type !== "text") throw new Error("Expected text");
      expect(JSON.parse(first.text)).toEqual({
        cpu: { utilizationPercent: 12, logicalProcessors: 2 },
        memory: { totalBytes: 100, usedBytes: 40 },
        systemStorage: { totalBytes: 1000, usedBytes: 100, availableBytes: 800 },
      });
      expect(fake.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "POST /v1/users/login",
        "GET /v1/sys/utilization",
      ]);
      expect(fake.calls[1]?.headers.authorization).toBe("Bearer test-token");
    } finally {
      await client.close();
      await st.close();
    }
  });
});
