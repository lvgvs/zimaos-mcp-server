import { describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AppError } from "../src/errors.js";
import { PermissionLayer } from "../src/permissions.js";
import { createMcpServer, type ToolDeps } from "../src/mcp/tools.js";
import { AppService } from "../src/zimaos/appService.js";
import type { ZimaOsClient } from "../src/zimaos/client.js";

async function harness(failed = false) {
  const listComposeApps = vi.fn(async () => ({
    sample: {
      status: "running",
      update_available: false,
      is_uncontrolled: true,
      store_info: {
        title: { en_us: "Sample Application", tr: "Örnek" },
        main: "web",
        password: "private-marker",
      },
    },
  }));
  const getComposeAppContainers = vi.fn(async () => {
    if (failed) throw new AppError("PERMISSION_DENIED", "private-marker");
    return {
      main: "web",
      containers: { web: { Service: "web", State: "running" }, db: { Service: "db" } },
    };
  });
  const probeComposeAppHealth = vi.fn(async () => ({ state: "unknown" as const }));
  const apps = new AppService({
    isAppMetadataSafe: () => true,
    listComposeApps,
    getComposeAppContainers,
    probeComposeAppHealth,
  } as unknown as ZimaOsClient);
  const server = createMcpServer({
    apps,
    system: {} as ToolDeps["system"],
    permissions: new PermissionLayer({ allowAppControl: false }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "app-details-tests", version: "0.0.1" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const text = result.content?.[0];
    if (text?.type !== "text") throw new Error("expected JSON text");
    expect(text.text).not.toContain("private-marker");
    return JSON.parse(text.text);
  };
  return {
    client,
    call,
    listComposeApps,
    getComposeAppContainers,
    probeComposeAppHealth,
    close: () => st.close(),
  };
}

const touched = ["list_apps", "get_app", "get_app_health", "list_app_containers"];
describe("existing application tools on the actual MCP wire", () => {
  it("retains 21 tools and input shapes while declaring explicit read-only annotations", async () => {
    const h = await harness();
    try {
      const { tools } = await h.client.listTools();
      expect(tools).toHaveLength(21);
      for (const name of touched) {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        });
        expect(tool.inputSchema.type).toBe("object");
        expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
          name === "list_apps" ? [] : ["app_id"],
        );
      }
      expect(h.listComposeApps).not.toHaveBeenCalled();
    } finally {
      await h.close();
    }
  });

  it("passes the new fields through existing wrappers without additional reads", async () => {
    const h = await harness();
    try {
      const expected = {
        id: "sample",
        name: "Sample Application",
        mainService: "web",
        status: "running",
        updateAvailable: false,
        isUncontrolled: true,
      };
      expect(await h.call("list_apps")).toEqual({ apps: [expected] });
      expect(await h.call("get_app", { app_id: "sample" })).toEqual({ app: expected });
      const listed = await h.call("list_app_containers", { app_id: "sample" });
      expect(listed.containers).toMatchObject([
        { service: "web", isMainService: true },
        { service: "db", isMainService: false },
      ]);
      const health = await h.call("get_app_health", { app_id: "sample" });
      expect(health).toEqual({
        app: "sample",
        probe: { state: "unknown" },
        containers: listed.containers,
        containersReadStatus: "succeeded",
      });
      expect(h.listComposeApps).toHaveBeenCalledTimes(2);
      expect(h.getComposeAppContainers).toHaveBeenCalledTimes(2);
      expect(h.probeComposeAppHealth).toHaveBeenCalledTimes(1);
    } finally {
      await h.close();
    }
  });

  it("discloses sanitized failed-read data on the wire without inventing an unhealthy probe", async () => {
    const h = await harness(true);
    try {
      expect(await h.call("get_app_health", { app_id: "sample" })).toEqual({
        app: "sample",
        probe: { state: "unknown" },
        containers: [],
        containersReadStatus: "failed",
        containersReadErrorCode: "PERMISSION_DENIED",
      });
    } finally {
      await h.close();
    }
  });

  it("rejects malformed existing inputs before app traffic and still denies mutations", async () => {
    const h = await harness();
    try {
      for (const name of touched.filter((n) => n !== "list_apps")) {
        for (const args of [{}, { app_id: "" }, { app_id: 1 }]) {
          const result = await h.client.callTool({ name, arguments: args });
          expect(result.isError).toBe(true);
        }
      }
      expect(
        (await h.client.callTool({ name: "start_app", arguments: { app_id: "sample" } }))
          .isError,
      ).toBe(true);
      expect(h.listComposeApps).not.toHaveBeenCalled();
      expect(h.getComposeAppContainers).not.toHaveBeenCalled();
      expect(h.probeComposeAppHealth).not.toHaveBeenCalled();
    } finally {
      await h.close();
    }
  });
});
