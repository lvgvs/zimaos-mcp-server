import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { sourceFingerprint } from "../src/approval/intent.js";
import { createHttpServer } from "../src/http/server.js";
import { PermissionLayer } from "../src/permissions.js";
import type { ToolDeps } from "../src/mcp/tools.js";
import type { AppConfig } from "../src/config.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const ID = "p3-modern-approval";
const BASE = `name: ${ID}\nservices:\n  web:\n    image: nginx:alpine\n`;
const CANDIDATE = BASE + "    privileged: true\n";
const PATH = `/v2/app_management/compose/${ID}`;
const AUTH = "fixture-edit-auth-token-minimum-length-0123456789";
const args = (source = CANDIDATE, appId = ID, base = sourceFingerprint(BASE)) => ({
  app_id: appId,
  expected_fingerprint: base,
  source,
});

describe("modern existing-app edit approval over authenticated HTTP", () => {
  let server: http.Server;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let fake: FakeZimaOs;
  beforeAll(async () => {
    fake = new FakeZimaOs();
    fake.ok("POST", "/v1/users/login", { token: { access_token: "fixture-token" } });
    fake.on("GET", PATH, { text: BASE });
    fake.on("PUT", PATH, { json: { message: "validated" } });
    const api = new ZimaOsClient({
      baseUrl: "http://zimaos.test",
      username: "admin",
      password: "fixture-password",
      fetchImpl: fake.fetchImpl,
      timeoutMs: 500,
    });
    const deps: ToolDeps = {
      apps: new AppService(api),
      system: { getSystemInfo: async () => ({ hostname: "zima" }) } as ToolDeps["system"],
      permissions: new PermissionLayer({ allowAppControl: false, allowAppEdit: true }),
    };
    const config: AppConfig = {
      zimaosUrl: "http://zimaos.test",
      zimaosUsername: "admin",
      zimaosPassword: "fixture-password",
      mcpAuthToken: AUTH,
      allowAppControl: false,
      allowAppEdit: true,
      port: 0,
      logLevel: "error",
    };
    server = createHttpServer({ config, deps });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = new URL(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    );
    transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${AUTH}` } },
    });
    client = new Client(
      { name: "edit-approval-test", version: "0.0.1" },
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

  it("returns native input_required, signs exact intent and never mutates on first round", async () => {
    expect(client.getProtocolEra()).toBe("modern");
    const result = await client.callTool(
      { name: "edit_app_compose", arguments: args() },
      { allowInputRequired: true },
    );
    const raw = result as unknown as {
      resultType?: string;
      requestState?: string;
      inputRequests?: Record<string, unknown>;
    };
    expect(raw.resultType).toBe("input_required");
    expect(raw.requestState).toMatch(/^v1\./);
    expect(raw.inputRequests?.["approve_edit"]).toBeDefined();
    expect(
      fake.calls.filter((call) => call.method === "PUT" && call.path === PATH),
    ).toHaveLength(1);
  });
  it("checks signed continuation and single-use approval before one real PUT", async () => {
    const initial = await client.callTool(
      { name: "edit_app_compose", arguments: args() },
      { allowInputRequired: true },
    );
    const state = (initial as unknown as { requestState: string }).requestState;
    const before = fake.calls.filter(
      (call) => call.method === "PUT" && call.path === PATH,
    ).length;
    const round = (argumentsValue = args(), token = state, confirm = true) =>
      client.request(
        {
          method: "tools/call",
          params: {
            name: "edit_app_compose",
            arguments: argumentsValue,
            requestState: token,
            inputResponses: { approve_edit: { action: "accept", content: { confirm } } },
          },
        },
        z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()) }),
      );
    expect((await round(args(CANDIDATE + "# altered\n"))).isError).toBe(true);
    expect((await round(args(CANDIDATE, "another-app"))).isError).toBe(true);
    expect((await round(args(CANDIDATE, ID, "a".repeat(64)))).isError).toBe(true);
    expect((await round(args(), state, false)).isError).toBe(true);
    expect(
      fake.calls.filter((call) => call.method === "PUT" && call.path === PATH),
    ).toHaveLength(before);
    const result = await round();
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(
      fake.calls.filter((call) => call.method === "PUT" && call.path === PATH),
    ).toHaveLength(before + 2);
    expect((await round()).isError).toBe(true);
    expect(
      fake.calls.filter((call) => call.method === "PUT" && call.path === PATH),
    ).toHaveLength(before + 2);
  });

  it("fails closed for a legacy risky-edit client before any real apply", async () => {
    const endpoint = new URL(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    );
    const legacyTransport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${AUTH}` } },
    });
    const legacy = new Client({ name: "legacy-edit", version: "0.0.1" });
    await legacy.connect(legacyTransport);
    try {
      expect(legacy.getProtocolEra()).toBe("legacy");
      const before = fake.calls.filter(
        (call) => call.method === "PUT" && call.path === PATH,
      ).length;
      const result = await legacy.callTool({
        name: "edit_app_compose",
        arguments: args(),
      });
      expect(result.isError).toBe(true);
      expect(
        fake.calls.filter((call) => call.method === "PUT" && call.path === PATH),
      ).toHaveLength(before + 1);
    } finally {
      await legacyTransport.close();
    }
  });
});
