import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const path = "/v2/app_management/compose/test-app";
const source = "name: test-app\nservices:\n  web:\n    image: nginx:alpine\n";
function setup() {
  const fake = new FakeZimaOs();
  fake.ok("POST", "/v1/users/login", {
    token: { access_token: "local-test-token", refresh_token: "unused" },
  });
  const client = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "test",
    password: "local-password-value",
    fetchImpl: fake.fetchImpl,
  });
  return { fake, client };
}

describe("existing-app Compose official API client (mocked)", () => {
  it("projects only native association when unrelated YAML contains credentials, while raw reads remain denied", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, {
      text:
        source +
        "x-casaos: {id: com.example.app, repo_id: example}\n# local-password-value\n",
    });
    expect(await client.getComposeAppAssociation("test-app")).toEqual({
      appId: "com.example.app",
      repoId: "example",
    });
    await expect(client.getComposeAppYaml("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });
  it("refuses to return the configured ZimaOS credential if interpolated into Compose", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, { text: source + "# local-password-value\n" });
    await expect(client.getComposeAppYaml("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });
  it("rejects credential-bearing identities rather than reflecting them", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, {
      text: source + "x-casaos: {id: com.example.local-password-value}\n",
    });
    await expect(client.getComposeAppAssociation("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });
  it("bounds association body timeout and disables redirect following", async () => {
    let redirect;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/users/login"))
        return new Response(
          JSON.stringify({ data: { token: { access_token: "fixture-token" } } }),
        );
      redirect = init?.redirect;
      return new Response(
        new ReadableStream({
          start() {
            /* deliberately no chunks */
          },
        }),
      );
    };
    const client = new ZimaOsClient({
      baseUrl: "http://example.test",
      username: "test",
      password: "synthetic",
      fetchImpl,
      timeoutMs: 20,
    });
    await expect(client.getComposeAppAssociation("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UNREACHABLE",
    });
    expect(redirect).toBe("error");
  });
  it("reads interpolated YAML as exact returned bytes with a YAML Accept header", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, { text: source });
    expect(await client.getComposeAppYaml("test-app")).toBe(source);
    expect(fake.calls[1]).toMatchObject({ method: "GET", path });
    expect(fake.calls[1]?.headers["accept"]).toBe("application/yaml");
  });

  it("does not relay upstream error bodies and maps missing/auth failures", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, { status: 404, text: "secret-from-upstream" });
    const error = await client.getComposeAppYaml("test-app").catch((err: unknown) => err);
    expect(error).toMatchObject({ code: "ZIMAOS_NOT_FOUND" });
    expect(String(error)).not.toContain("secret-from-upstream");
  });

  it("bounds the YAML response and rejects invalid UTF-8", async () => {
    const { fake, client } = setup();
    fake.on("GET", path, { text: "x".repeat(512 * 1024 + 1) });
    await expect(client.getComposeAppYaml("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
    const other = setup();
    other.fake.on("GET", path, { text: "" });
    await expect(other.client.getComposeAppYaml("test-app")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });

  it("sends the exact source only to the existing-app PUT dry-run", async () => {
    const { fake, client } = setup();
    fake.on("PUT", path, { json: { message: "validated" } });
    expect(await client.validateComposeChange("test-app", source)).toEqual({
      status: "accepted",
      accepted: true,
      portsInUse: undefined,
    });
    expect(fake.calls[1]).toMatchObject({
      method: "PUT",
      path,
      body: source,
    });
    expect(fake.calls[1]?.headers["content-type"]).toBe("application/yaml");
  });

  it("normalizes port rejection and ambiguous invalid-Compose 502", async () => {
    const { fake, client } = setup();
    fake.on("PUT", path, { status: 400, json: { data: { ports_in_use: [80] } } });
    fake.on("PUT", path, { status: 502, text: "" });
    expect(await client.validateComposeChange("test-app", source)).toMatchObject({
      status: "rejected",
      portsInUse: [80],
    });
    expect(await client.validateComposeChange("test-app", source)).toMatchObject({
      status: "upstream_error",
      accepted: false,
    });
  });
  it("recognizes the observed async existing-app acceptance without claiming completion", async () => {
    const { fake, client } = setup();
    fake.on("PUT", path, {
      json: { message: "app is being applied with changes asynchronously" },
    });
    expect(await client.applyComposeChangeOnce("test-app", source)).toMatchObject({
      status: "accepted",
      accepted: true,
    });
    expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("keeps unrelated 200 messages ambiguous and explicit failure rejected without reflecting upstream text", async () => {
    const verified = "app is being applied with changes asynchronously";
    for (const { body, status } of [
      { body: { message: "accepted: " + source }, status: "upstream_error" },
      { body: { message: verified, extra: true }, status: "upstream_error" },
      { body: { message: verified, success: false }, status: "rejected" },
      { body: { message: "failure: " + source, success: false }, status: "rejected" },
    ] as const) {
      const { fake, client } = setup();
      fake.on("PUT", path, { json: body });
      const result = await client.applyComposeChangeOnce("test-app", source);
      expect(result).toMatchObject({ status, accepted: false });
      expect(JSON.stringify(result)).not.toContain(source);
      expect(JSON.stringify(result)).not.toContain("failure:");
      expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    }
  });

  it("keeps 4xx rejections separate from auth and rate-limit failures", async () => {
    for (const code of [400, 404]) {
      const { fake, client } = setup();
      fake.on("PUT", path, { status: code, json: { message: source } });
      expect(await client.applyComposeChangeOnce("test-app", source)).toMatchObject({
        status: "rejected",
        accepted: false,
      });
      expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    }
    for (const [status, errorCode] of [
      [403, "PERMISSION_DENIED"],
      [429, "ZIMAOS_RATE_LIMITED"],
    ] as const) {
      const { fake, client } = setup();
      fake.on("PUT", path, { status, json: { message: source } });
      const error = await client
        .applyComposeChangeOnce("test-app", source)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: errorCode });
      expect(String(error)).not.toContain(source);
      expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    }
  });

  it("applies the exact source via one official real PUT and never retries a 401", async () => {
    const { fake, client } = setup();
    fake.on("PUT", path, { json: { success: true } });
    expect(await client.applyComposeChangeOnce("test-app", source)).toMatchObject({
      status: "accepted",
    });
    expect(fake.calls[1]).toMatchObject({ method: "PUT", path, body: source });
    const unauthorized = setup();
    unauthorized.fake.on("PUT", path, { status: 401 });
    await expect(
      unauthorized.client.applyComposeChangeOnce("test-app", source),
    ).rejects.toMatchObject({ code: "ZIMAOS_AUTH_FAILED" });
    expect(unauthorized.fake.calls.filter((call) => call.method === "PUT")).toHaveLength(
      1,
    );
  });
});
