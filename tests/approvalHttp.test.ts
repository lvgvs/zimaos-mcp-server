import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const SOURCE =
  "name: approved-http-r1\nservices:\n  web:\n    image: nginx:alpine\n    privileged: true\n";
const PATH = "/v2/app_management/compose";
const AUTH = "fixture-opaque-auth-token-minimum-length-0123456789";

function config(): AppConfig {
  return {
    zimaosUrl: "http://zimaos.test",
    zimaosUsername: "admin",
    zimaosPassword: "fixture-only",
    mcpAuthToken: AUTH,
    allowAppControl: false,
    allowAppInstall: true,
    port: 0,
    logLevel: "error",
  };
}

describe("modern risky approval over authenticated HTTP", () => {
  let server: http.Server;
  let endpoint: URL;
  let fake: FakeZimaOs;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    fake = new FakeZimaOs();
    fake.ok("POST", "/v1/users/login", { token: { access_token: "fixture-token" } });
    fake.ok("GET", PATH, {});
    fake.ok("POST", PATH, {});
    const api = new ZimaOsClient({
      baseUrl: "http://zimaos.test",
      username: "admin",
      password: "fixture-only",
      fetchImpl: fake.fetchImpl,
      timeoutMs: 500,
    });
    const deps: ToolDeps = {
      apps: new AppService(api),
      system: { getSystemInfo: async () => ({ hostname: "zima" }) } as ToolDeps["system"],
      permissions: new PermissionLayer({ allowAppControl: false, allowAppInstall: true }),
    };
    server = createHttpServer({ config: config(), deps });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${AUTH}` } },
    });
    client = new Client(
      { name: "approval-test", version: "0.0.1" },
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

  it("first round returns signed native input_required without mutation", async () => {
    expect(client.getProtocolEra()).toBe("modern");
    const result = await client.callTool(
      { name: "install_app_from_compose", arguments: { source: SOURCE } },
      { allowInputRequired: true },
    );
    const raw = result as unknown as {
      resultType?: string;
      requestState?: string;
      inputRequests?: Record<string, unknown>;
    };
    expect(raw.resultType).toBe("input_required");
    expect(raw.requestState).toMatch(/^v1\./);
    expect(raw.inputRequests?.["approve_install"]).toBeDefined();
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === PATH)).toHaveLength(
      1,
    );
  });

  it("requires signed state and accepted confirmation on the second round, then rejects replay", async () => {
    const source = SOURCE.replace("approved-http-r1", "approved-http-r2");
    const initial = await client.callTool(
      { name: "install_app_from_compose", arguments: { source } },
      { allowInputRequired: true },
    );
    const state = (initial as unknown as { requestState: string }).requestState;
    expect(state).toMatch(/^v1\./);
    const before = fake.calls.filter(
      (c) => c.method === "POST" && c.path === PATH,
    ).length;
    const retry = () =>
      client.request(
        {
          method: "tools/call",
          params: {
            name: "install_app_from_compose",
            arguments: { source },
            requestState: state,
            inputResponses: {
              approve_install: { action: "accept", content: { confirm: true } },
            },
          },
        },
        z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()) }),
      );
    const result = await retry();
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({
        status: "accepted",
        accepted: true,
        reconciliation: "pending",
      }),
    });
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === PATH)).toHaveLength(
      before + 2,
    );
    expect((await retry()).isError).toBe(true);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === PATH)).toHaveLength(
      before + 2,
    );
  });

  it("fails closed on declined, missing, tampered, or content-mismatched continuation", async () => {
    const source = SOURCE.replace("approved-http-r1", "approved-http-r3");
    const first = await client.callTool(
      { name: "install_app_from_compose", arguments: { source } },
      { allowInputRequired: true },
    );
    const state = (first as unknown as { requestState: string }).requestState;
    const before = fake.calls.filter(
      (c) => c.method === "POST" && c.path === PATH,
    ).length;
    const round = (nextSource: string, token: string | undefined, confirm: boolean) =>
      client.request(
        {
          method: "tools/call",
          params: {
            name: "install_app_from_compose",
            arguments: { source: nextSource },
            ...(token && { requestState: token }),
            inputResponses: {
              approve_install: { action: "accept", content: { confirm } },
            },
          },
        },
        z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()) }),
      );
    expect((await round(source, state, false)).isError).toBe(true);
    expect((await round(source, undefined, true)).isError).toBe(true);
    await expect(round(source, `${state}tampered`, true)).rejects.toThrow();
    expect((await round(source + "# changed\n", state, true)).isError).toBe(true);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === PATH)).toHaveLength(
      before,
    );
  });
});
