import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/tools.js";
import { PermissionLayer } from "../src/permissions.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

async function setup(enabled: boolean, id: string) {
  const fake = new FakeZimaOs();
  fake.on("POST", "/v1/users/login", {
    json: { success: true, data: { token: { access_token: "fake-token" } } },
  });
  fake.ok("GET", "/v2/app_management/compose", { [id]: { name: id } });
  fake.on("DELETE", `/v2/app_management/compose/${id}`, {
    json: { success: true },
  });
  const apps = new AppService(
    new ZimaOsClient({
      baseUrl: "http://zimaos.test",
      username: "admin",
      password: "pw",
      fetchImpl: fake.fetchImpl,
    }),
  );
  const server = createMcpServer({
    apps,
    system: {} as never,
    permissions: new PermissionLayer({
      allowAppControl: false,
      allowAppUninstall: enabled,
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "uninstall-test", version: "1" });
  await client.connect(clientTransport);
  return { fake, client, serverTransport };
}

function text(result: { content?: CallToolResult["content"] }) {
  const first = result.content?.[0];
  return first?.type === "text" ? first.text : "";
}

describe("uninstall_app MCP tool", () => {
  it("default-off denies with zero login/list/DELETE", async () => {
    const h = await setup(false, "tool-denied");
    try {
      const result = await h.client.callTool({
        name: "uninstall_app",
        arguments: { app_id: "tool-denied" },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("APP_UNINSTALL_DISABLED");
      expect(h.fake.calls).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("explicit id makes exactly one DELETE, accepts asynchronously, and observes pending", async () => {
    const h = await setup(true, "tool-pending");
    try {
      const result = await h.client.callTool({
        name: "uninstall_app",
        arguments: { app_id: "tool-pending" },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toEqual({
        status: "accepted",
        accepted: true,
        reconciliation: "pending",
      });
      expect(h.fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
      const duplicate = await h.client.callTool({
        name: "uninstall_app",
        arguments: { app_id: "tool-pending" },
      });
      expect(duplicate.isError).toBe(true);
      expect(h.fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    } finally {
      await h.serverTransport.close();
    }
  });

  it("missing/unsafe ids never reach the host", async () => {
    const h = await setup(true, "tool-invalid");
    try {
      for (const app_id of ["", "../other", "id/other"]) {
        const result = await h.client.callTool({
          name: "uninstall_app",
          arguments: { app_id },
        });
        expect(result.isError).toBe(true);
      }
      expect(h.fake.calls).toHaveLength(0);
    } finally {
      await h.serverTransport.close();
    }
  });
});
