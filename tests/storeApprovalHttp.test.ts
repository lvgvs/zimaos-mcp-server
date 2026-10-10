import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createHttpServer } from "../src/http/server.js";
import { PermissionLayer } from "../src/permissions.js";
import type { ToolDeps } from "../src/mcp/tools.js";
import type { AppConfig } from "../src/config.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";

const AUTH = "synthetic-store-http-test-auth-minimum-length-0123456789";
const selection = { repo_id: "example", app_id: "com.example.http" };
const source =
  "name: store-http-approved\nx-casaos:\n  id: com.example.http\nservices:\n  web:\n    image: example/image:latest\n    privileged: true\n";

describe("modern native store approval over authenticated HTTP", () => {
  let server: http.Server;
  let endpoint: URL;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const api = new ZimaOsClient({
    baseUrl: "http://example.test",
    username: "test",
    password: "synthetic",
    fetchImpl: async () => {
      throw new Error("unexpected traffic");
    },
  });
  const catalog = vi.spyOn(api, "getStoreCompose").mockResolvedValue(source);
  const dryRun = vi
    .spyOn(api, "validateNativeStoreCompose")
    .mockResolvedValue({ status: "accepted", accepted: true });
  const mutation = vi
    .spyOn(api, "installNativeStoreComposeOnce")
    .mockResolvedValue({ status: "accepted", accepted: true });

  beforeAll(async () => {
    vi.spyOn(api, "getStoreRepositories").mockResolvedValue([
      { id: "example", enabled: true, version: "v2", transport: "http" },
    ]);
    vi.spyOn(api, "getAppManagementArchitecture").mockResolvedValue("amd64");
    vi.spyOn(api, "getStoreAppDetail").mockResolvedValue({
      id: selection.app_id,
      repo_id: "example",
      type: "compose",
      architectures: ["amd64"],
      source: {
        compose_arch: "amd64",
        compose_path: "/apps/com.example.http/docker-compose.amd64.yml",
        compose_architectures: {
          amd64: { path: "/apps/com.example.http/docker-compose.amd64.yml" },
        },
      },
    });
    vi.spyOn(api, "listComposeApps").mockResolvedValue({});
    const config: AppConfig = {
      zimaosUrl: "http://example.test",
      zimaosUsername: "test",
      zimaosPassword: "synthetic",
      mcpAuthToken: AUTH,
      allowAppControl: false,
      allowAppInstall: true,
      port: 0,
      logLevel: "error",
    };
    const deps: ToolDeps = {
      apps: new AppService(api),
      system: { getSystemInfo: async () => ({}) } as ToolDeps["system"],
      permissions: new PermissionLayer({ allowAppControl: false, allowAppInstall: true }),
    };
    server = createHttpServer({ config, deps });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${AUTH}` } },
    });
    client = new Client(
      { name: "store-approval-test", version: "0.0.1" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        inputRequired: { autoFulfill: false },
        capabilities: { elicitation: { form: {} } },
      },
    );
    await client.connect(transport);
  });
  afterAll(async () => {
    await transport?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("signs the native intent, denies malformed continuations and re-resolves before one mutation", async () => {
    const initial = await client.callTool(
      { name: "install_app_from_store", arguments: selection },
      { allowInputRequired: true },
    );
    const raw = initial as unknown as {
      resultType: string;
      requestState: string;
      inputRequests: Record<string, unknown>;
    };
    expect(raw.resultType).toBe("input_required");
    expect(raw.requestState).toMatch(/^v1\./);
    expect(raw.inputRequests.approve_store_install).toBeDefined();
    expect(mutation).not.toHaveBeenCalled();
    const approvedBytes = dryRun.mock.calls[0]?.[0];
    expect(approvedBytes).toContain("repo_id: example");
    const round = (
      args = selection,
      state: string | undefined = raw.requestState,
      confirm = true,
      tool = "install_app_from_store",
    ) =>
      client.request(
        {
          method: "tools/call",
          params: {
            name: tool,
            arguments: args,
            ...(state && { requestState: state }),
            inputResponses: {
              approve_store_install: { action: "accept", content: { confirm } },
            },
          },
        },
        z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()) }),
      );
    expect((await round(selection, raw.requestState, false)).isError).toBe(true);
    await expect(round(selection, `${raw.requestState}tampered`)).rejects.toThrow();
    expect((await round({ ...selection, repo_id: "other" })).isError).toBe(true);
    expect((await round({ ...selection, app_id: "com.example.other" })).isError).toBe(
      true,
    );
    expect(
      (
        await round(
          { source } as unknown as typeof selection,
          raw.requestState,
          true,
          "install_app_from_compose",
        )
      ).isError,
    ).toBe(true);
    catalog.mockResolvedValueOnce(`${source}# changed\n`);
    expect((await round()).isError).toBe(true);
    expect(mutation).not.toHaveBeenCalled();
    const outcome = await round();
    expect(outcome.isError).toBeFalsy();
    expect(outcome.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({
        status: "accepted",
        accepted: true,
        reconciliation: "pending",
      }),
    });
    expect(mutation).toHaveBeenCalledExactlyOnceWith(approvedBytes);
    expect((await round()).isError).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy fail-closed behavior without exposing internal source", async () => {
    const legacyTransport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${AUTH}` } },
    });
    const legacy = new Client(
      { name: "legacy-store-test", version: "0.0.1" },
      { versionNegotiation: { mode: "legacy" } },
    );
    try {
      await legacy.connect(legacyTransport);
      // Use a new native identity because the accepted one remains reserved.
      vi.mocked(api.getStoreAppDetail).mockResolvedValueOnce({
        id: "com.example.legacy",
        repo_id: "example",
        type: "compose",
        architectures: ["amd64"],
        source: {
          compose_arch: "amd64",
          compose_path: "/apps/com.example.legacy/docker-compose.amd64.yml",
          compose_architectures: {
            amd64: { path: "/apps/com.example.legacy/docker-compose.amd64.yml" },
          },
        },
      });
      catalog.mockResolvedValueOnce(
        source
          .replaceAll("com.example.http", "com.example.legacy")
          .replace("store-http-approved", "store-http-legacy"),
      );
      const result = await legacy.callTool({
        name: "install_app_from_store",
        arguments: { ...selection, app_id: "com.example.legacy" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("modern MCP elicitation");
      expect(JSON.stringify(result)).not.toContain("services:");
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      await legacyTransport.close();
    }
  });
});
