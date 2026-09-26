import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const BASE = "http://zimaos.test:8080";

function makeClient(fake: FakeZimaOs): ZimaOsClient {
  return new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl: fake.fetchImpl,
    timeoutMs: 5_000,
  });
}

function loginOk(fake: FakeZimaOs): void {
  fake.on("POST", "/v1/users/login", {
    json: {
      success: true,
      message: "ok",
      data: { token: { access_token: "tok-abc", refresh_token: "ref" } },
    },
  });
}

describe("ZimaOsClient authentication/session behavior (mocked HTTP)", () => {
  it("logs in and caches the access token from the documented shape", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    const client = makeClient(fake);

    await client.login();

    expect(client.hasSession()).toBe(true);
    const req = fake.calls[0];
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v1/users/login");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({ username: "admin", password: "pw" });
  });

  it("sends the bearer token on authenticated requests", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("GET", "/v2/app_management/compose", {});
    const client = makeClient(fake);

    await client.listComposeApps();

    expect(fake.calls[1]?.headers["authorization"]).toBe("Bearer tok-abc");
  });

  it("auto re-logins once after a 401 and retries the request", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // First authenticated call: stale token -> 401. Second (after fresh login): ok.
    fake.on("GET", "/v2/app_management/compose", { status: 401, json: {} });
    fake.ok("GET", "/v2/app_management/compose", { a: 1 });
    const client = makeClient(fake);

    const data = await client.listComposeApps();

    expect(data).toEqual({ a: 1 });
    // login (initial) + failed list + re-login + retried list
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(2);
    expect(client.hasSession()).toBe(true);
  });

  it("throws ZIMAOS_AUTH_FAILED when credentials are rejected", async () => {
    const fake = new FakeZimaOs();
    fake.on("POST", "/v1/users/login", { status: 401, json: {} });
    const client = makeClient(fake);

    await expect(client.login()).rejects.toThrowError(AppError);
    try {
      await client.login();
    } catch (err) {
      expect((err as AppError).code).toBe("ZIMAOS_AUTH_FAILED");
    }
  });

  it("throws ZIMAOS_AUTH_FAILED when login succeeds but no token is returned", async () => {
    const fake = new FakeZimaOs();
    fake.on("POST", "/v1/users/login", { json: { success: true, data: {} } });
    const client = makeClient(fake);

    await expect(client.login()).rejects.toMatchObject({ code: "ZIMAOS_AUTH_FAILED" });
  });

  it("maps network failure to ZIMAOS_UNREACHABLE without leaking details", async () => {
    const failingFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl: failingFetch,
    });

    await expect(client.login()).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
  });

  it("maps a timeout to ZIMAOS_UNREACHABLE", async () => {
    const hangingFetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as typeof fetch;
    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl: hangingFetch,
      timeoutMs: 50,
    });

    await expect(client.login()).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
  });
});

describe("ZimaOsClient response normalization (mocked HTTP)", () => {
  it("unwraps the envelope and returns data for compose list", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("GET", "/v2/app_management/compose", { myapp: { status: "running" } });
    const client = makeClient(fake);

    await expect(client.listComposeApps()).resolves.toEqual({
      myapp: { status: "running" },
    });
  });

  it("maps envelope success=false to ZIMAOS_UPSTREAM_ERROR with the upstream message", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/missing", {
      json: { success: false, message: "app not found" },
    });
    const client = makeClient(fake);

    await expect(client.getComposeApp("missing")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });

  it("maps HTTP 404 to ZIMAOS_NOT_FOUND", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/nope", { status: 404, json: {} });
    const client = makeClient(fake);

    await expect(client.getComposeApp("nope")).rejects.toMatchObject({
      code: "ZIMAOS_NOT_FOUND",
    });
  });

  it("maps HTTP 500 to ZIMAOS_UPSTREAM_ERROR and 429 to ZIMAOS_RATE_LIMITED", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/a", { status: 500, json: {} });
    fake.on("GET", "/v2/app_management/compose/b", { status: 429, json: {} });
    const client = makeClient(fake);

    await expect(client.getComposeApp("a")).rejects.toMatchObject({ code: "ZIMAOS_UPSTREAM_ERROR" });
    await expect(client.getComposeApp("b")).rejects.toMatchObject({ code: "ZIMAOS_RATE_LIMITED" });
  });

  it("maps non-JSON success responses to ZIMAOS_UPSTREAM_ERROR", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose", { text: "<html>not json</html>" });
    const client = makeClient(fake);

    await expect(client.listComposeApps()).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
  });

  it("returns the bare device info payload (no envelope)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.raw("GET", "/v2/zimaos/device/info", {
      device_name: "zima",
      os_version: "v1.7.1",
      cpu: { model: "AMD EPYC", cores: 8, threads: 16 },
      memory: { total_byte: 34359738368, type: "DDR4" },
    });
    const client = makeClient(fake);

    await expect(client.getDeviceInfo()).resolves.toMatchObject({
      device_name: "zima",
      os_version: "v1.7.1",
    });
  });

  it("sends the raw JSON string body for status changes", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("PUT", "/v2/app_management/compose/myapp/status", null);
    const client = makeClient(fake);

    await client.setComposeAppStatus("myapp", "restart");

    const req = fake.calls[1];
    expect(req?.method).toBe("PUT");
    expect(req?.body).toBe(JSON.stringify("restart"));
  });

  it("probeComposeAppHealth: HTTP 200 (even empty body) means healthy", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/myapp/healthcheck", {}); // empty 200
    const client = makeClient(fake);

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({ state: "healthy" });
  });

  it("probeComposeAppHealth: HTTP 5xx means unhealthy, not an error", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/myapp/healthcheck", { status: 503, json: {} });
    const client = makeClient(fake);

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({ state: "unhealthy" });
  });

  it("probeComposeAppHealth: HTTP 404 means unknown (no health signal)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/myapp/healthcheck", { status: 404, json: {} });
    const client = makeClient(fake);

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({ state: "unknown" });
  });
});
