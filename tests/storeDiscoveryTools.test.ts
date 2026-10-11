import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/mcp/tools.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { PermissionLayer } from "../src/permissions.js";
import type { SystemService } from "../src/zimaos/systemService.js";

async function harness() {
  const calls: { method: string; path: string }[] = [];
  const row = {
    id: "com.example.pdf",
    repo_id: "example",
    type: "compose",
    title: "PDF App",
    architectures: ["arm64", "amd64"],
    description: "Public description",
    source: { compose_url: "http://untrusted.invalid/secret" },
    envs: { PASSWORD: "hidden" },
  };
  const api = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "admin",
    password: "synthetic-password",
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      calls.push({ method: init?.method ?? "GET", path: u.pathname });
      if (u.pathname === "/v1/users/login")
        return Response.json({
          data: { token: { access_token: "synthetic-session-token" } },
        });
      if (init?.method !== "GET") throw Error("Mutation must not occur");
      if (u.pathname === "/v3/app_store/repo")
        return Response.json({
          data: [{ id: "example", enabled: true, version: "v2", transport: "http" }],
        });
      if (u.pathname === "/v3/app_store/hub/app/search")
        return Response.json({
          data: [row],
          pagination: { page: 1, page_size: 60, total: 1, total_pages: 1 },
          query: {
            query: u.searchParams.get("q"),
            locale: "en_US",
            repo_ids: ["example"],
            types: ["compose"],
          },
          status: { repo: { failed: [], succeeded: ["example"] } },
        });
      if (u.pathname === "/v3/app_store/hub/repo/example/app/com.example.pdf")
        return Response.json({ data: row });
      throw Error("Unexpected read");
    }) as typeof fetch,
  });
  const server = createMcpServer({
    apps: new AppService(api),
    system: {} as SystemService,
    permissions: new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: false,
      allowAppUninstall: false,
      allowAppEdit: false,
    }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "discovery-test", version: "0.0.1" });
  await client.connect(ct);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("Phase 7 MCP discovery", () => {
  it("registers readonly strict bounded schemas alongside the native installer", async () => {
    const h = await harness();
    try {
      const { tools } = await h.client.listTools();
      expect(tools).toHaveLength(20);
      expect(tools.some((t) => t.name === "install_app_from_store")).toBe(true);
      for (const name of ["search_app_store", "get_app_store_details"]) {
        const tool = tools.find((t) => t.name === name);
        expect(tool?.annotations?.readOnlyHint).toBe(true);
        expect(tool?.inputSchema.additionalProperties).toBe(false);
      }
      expect(h.calls).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
  it("searches and inspects an exact installer-compatible pair with every mutation permission disabled", async () => {
    const h = await harness();
    try {
      const search = await h.client.callTool({
        name: "search_app_store",
        arguments: { query: "pdf" },
      });
      expect(search.isError).toBeFalsy();
      const content = search.content?.[0];
      if (content?.type !== "text") throw Error("Expected search text");
      const result = JSON.parse(content.text) as {
        apps: { repo_id: string; app_id: string }[];
        truncated: boolean;
      };
      expect(result.apps[0]).toMatchObject({
        repo_id: "example",
        app_id: "com.example.pdf",
      });
      const detail = await h.client.callTool({
        name: "get_app_store_details",
        arguments: { repo_id: result.apps[0]?.repo_id, app_id: result.apps[0]?.app_id },
      });
      expect(detail.isError).toBeFalsy();
      const d = detail.content?.[0];
      if (d?.type !== "text") throw Error("Expected detail text");
      expect(JSON.parse(d.text)).toMatchObject({
        repo_id: "example",
        app_id: "com.example.pdf",
        description: "Public description",
        architectures: ["amd64", "arm64"],
      });
      expect(d.text).not.toMatch(/hidden|compose_url|untrusted|envs/);
      expect(h.calls.filter((c) => c.method !== "GET")).toEqual([
        { method: "POST", path: "/v1/users/login" },
      ]);
    } finally {
      await h.close();
    }
  });
  it("rejects malformed input and caller options before any upstream traffic", async () => {
    const h = await harness();
    try {
      for (const args of [
        { query: " " },
        { query: "a\nb" },
        { query: "x", limit: 51 },
        { query: "x", repo_url: "https://untrusted.invalid" },
      ]) {
        expect(
          (await h.client.callTool({ name: "search_app_store", arguments: args }))
            .isError,
        ).toBe(true);
      }
      for (const args of [
        { repo_id: "example", app_id: "notcanonical" },
        { repo_id: "https://untrusted.invalid", app_id: "com.example.pdf" },
        { repo_id: "example", app_id: "com.example.pdf", architecture: "arm64" },
      ]) {
        expect(
          (await h.client.callTool({ name: "get_app_store_details", arguments: args }))
            .isError,
        ).toBe(true);
      }
      expect(h.calls).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
});
