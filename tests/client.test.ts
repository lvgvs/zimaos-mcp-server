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
    const hangingFetch = (async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
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

    await expect(client.getComposeApp("a")).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
    await expect(client.getComposeApp("b")).rejects.toMatchObject({
      code: "ZIMAOS_RATE_LIMITED",
    });
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

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({
      state: "healthy",
    });
  });

  it("probeComposeAppHealth: HTTP 5xx means unhealthy, not an error", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/myapp/healthcheck", {
      status: 503,
      json: {},
    });
    const client = makeClient(fake);

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({
      state: "unhealthy",
    });
  });

  it("probeComposeAppHealth: HTTP 404 means unknown (no health signal)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v2/app_management/compose/myapp/healthcheck", {
      status: 404,
      json: {},
    });
    const client = makeClient(fake);

    await expect(client.probeComposeAppHealth("myapp")).resolves.toEqual({
      state: "unknown",
    });
  });
});

describe("ZimaOsClient.validateCompose (mocked HTTP, non-mutating dry run)", () => {
  const DRY_RUN_PATH = "/v2/app_management/compose?dry_run=true&check_port_conflict=true";

  /** Client whose fetch also records the full request URL (query string included). */
  function makeRecordingClient(fake: FakeZimaOs) {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      return fake.fetchImpl(input, init);
    }) as typeof fetch;
    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl,
      timeoutMs: 5_000,
    });
    return { client, urls };
  }

  it("HTTP 200 -> accepted (validation-only) without relaying the upstream message", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: {
        success: true,
        message: "validation-only; installation skipped",
        data: null,
      },
    });
    const client = makeClient(fake);

    const result = await client.validateCompose("services:\n  web:\n    image: nginx\n");

    expect(result).toEqual({
      status: "accepted",
      accepted: true,
    });
  });

  it("malformed YAML -> HTTP 400 -> rejected (not an exception)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 400,
      json: { success: false, message: "yaml parse error", data: null },
    });
    const client = makeClient(fake);

    const result = await client.validateCompose("services:\n  web: [unclosed\n");

    expect(result).toEqual({ status: "rejected", accepted: false });
  });

  it("port conflict -> HTTP 400 with data.ports_in_use -> rejected + bounded portsInUse", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 400,
      json: {
        success: false,
        message: "port conflict detected",
        data: { ports_in_use: [8080, 8443] },
      },
    });
    const client = makeClient(fake);

    const result = await client.validateCompose(
      'services:\n  web:\n    ports:\n      - "8080:80"\n',
    );

    expect(result).toEqual({
      status: "rejected",
      accepted: false,
      portsInUse: [8080, 8443],
    });
  });

  it("bounds and sanitizes data.ports_in_use (numeric strings ok; junk/out-of-range dropped)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 400,
      json: {
        success: false,
        message: "port conflict detected",
        data: { ports_in_use: ["8081", 99999, "not-a-port", -1, 0, 65535] },
      },
    });
    const client = makeClient(fake);

    const result = await client.validateCompose("services:\n  web:\n");

    expect(result.portsInUse).toEqual([8081, 65535]);
  });

  it("ambiguous empty HTTP 502 -> upstream_error (no invalid/unavailable claim)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // Observed live: schema-invalid dry-run returned an EMPTY 502 body.
    fake.on("POST", "/v2/app_management/compose", { status: 502 });
    const client = makeClient(fake);

    const result = await client.validateCompose("services:\n  web: 123\n");

    // Exactly this and nothing more: no verdict, no message, no ports.
    expect(result).toEqual({ status: "upstream_error", accepted: false });
  });

  it("refreshes once on 401 then reports persistent authentication failure", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 401, json: {} });
    fake.on("POST", "/v2/app_management/compose", { status: 401, json: {} });
    const client = makeClient(fake);
    await expect(client.validateCompose("services: {}\n")).rejects.toMatchObject({
      code: "ZIMAOS_AUTH_FAILED",
    });
    expect(fake.calls.filter((call) => call.path === "/v1/users/login")).toHaveLength(2);
    expect(
      fake.calls.filter((call) => call.path === "/v2/app_management/compose"),
    ).toHaveLength(2);
  });

  it("reports 403 as authorization failure rather than Compose rejection", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 403,
      json: { message: "secret from compose" },
    });
    const client = makeClient(fake);
    await expect(client.validateCompose("services: {}\n")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("never reflects partial YAML or secrets from an upstream message", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    const source =
      "services:\n  web:\n    environment:\n      API_KEY: secret-sentinel\n";
    fake.on("POST", "/v2/app_management/compose", {
      status: 400,
      json: { success: false, message: "invalid value: secret-sentinel" },
    });
    const client = makeClient(fake);
    const result = await client.validateCompose(source);
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    expect(result).toEqual({ status: "rejected", accepted: false });
  });

  it("does not accept a 2xx application envelope with success:false", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: { success: false, message: "validation failed" },
    });
    const client = makeClient(fake);
    await expect(client.validateCompose("services: {}\n")).resolves.toMatchObject({
      status: "rejected",
      accepted: false,
    });
  });

  it("sends the exact original UTF-8 body unchanged with application/yaml to the dry-run URL", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 200, json: {} });
    const { client, urls } = makeRecordingClient(fake);

    // Deliberately awkward source: unicode, comments, quotes, trailing newline.
    const source = 'services:\n  web: # café\n    image: "nginx:1.27"\n';
    await client.validateCompose(source);

    expect(urls[0]).toBe(`${BASE}/v1/users/login`);
    // Explicit dry-run + port-conflict query, exact path.
    expect(urls[1]).toBe(BASE + DRY_RUN_PATH);

    const req = fake.calls[1];
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v2/app_management/compose");
    // Exact original string, byte-for-byte (no re-serialization/normalization).
    expect(req?.body).toBe(source);
    expect(req?.headers["content-type"]).toBe("application/yaml");
    expect(req?.headers["authorization"]).toBe("Bearer tok-abc");
  });

  it("performs no real mutation: only login + dry-run POST, app list unchanged after", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 200, json: {} });
    // The app list stays empty before and after the dry run.
    fake.ok("GET", "/v2/app_management/compose", {});
    const client = makeClient(fake);

    const result = await client.validateCompose("services:\n  web:\n    image: nginx\n");
    expect(result.accepted).toBe(true);

    const apps = await client.listComposeApps();
    expect(apps).toEqual({});

    // Only login, the dry-run POST, and the read-only list call — no install/delete/patch.
    expect(fake.calls.map((c) => c.method)).toEqual(["POST", "POST", "GET"]);
    for (const call of fake.calls.slice(1)) {
      expect(call.path).toBe("/v2/app_management/compose");
    }
  });
});
