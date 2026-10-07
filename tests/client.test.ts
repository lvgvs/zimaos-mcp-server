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
  it("actively detects upstream failure after a cached login and recovers", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.raw("GET", "/v2/zimaos/device/info", { device: "test" });
    fake.on("GET", "/v2/zimaos/device/info", { status: 503 });
    fake.raw("GET", "/v2/zimaos/device/info", { device: "test" });
    const client = makeClient(fake);
    await client.login();
    expect(await client.checkReadiness()).toBe(true);
    expect(await client.checkReadiness()).toBe(false);
    expect(await client.checkReadiness()).toBe(true);
  });

  it("shares concurrent readiness probes", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.raw("GET", "/v2/zimaos/device/info", { device: "test" });
    const client = makeClient(fake);
    expect(await Promise.all([client.checkReadiness(), client.checkReadiness()])).toEqual(
      [true, true],
    );
    expect(
      fake.calls.filter((call) => call.path === "/v2/zimaos/device/info"),
    ).toHaveLength(1);
  });
  it("is not ready when device info explicitly reports failure on HTTP 200", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.raw("GET", "/v2/zimaos/device/info", {
      success: false,
      message: "SYNTHETIC_SECRET",
    });
    expect(await makeClient(fake).checkReadiness()).toBe(false);
  });

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
  it.each(["raw", "install", "uninstall", "validation"])(
    "normalizes response-body failures on %s",
    async (operation) => {
      const fake = new FakeZimaOs();
      loginOk(fake);
      const client = new ZimaOsClient({
        baseUrl: BASE,
        username: "admin",
        password: "pw",
        fetchImpl: (async (input, init) => {
          if (String(input).endsWith("/v1/users/login"))
            return fake.fetchImpl(input, init);
          const response = new Response("{}");
          Object.defineProperty(response, "text", {
            value: async () => {
              throw new Error("SYNTHETIC_SECRET");
            },
          });
          return response;
        }) as typeof fetch,
      });
      const result =
        operation === "raw"
          ? client.listComposeApps()
          : operation === "install"
            ? client.installComposeOnce("services: {}")
            : operation === "uninstall"
              ? client.uninstallComposeOnce("example")
              : client.validateCompose("services: {}");
      await expect(result).rejects.toMatchObject({
        code: "ZIMAOS_UNREACHABLE",
        message: expect.not.stringContaining("SYNTHETIC_SECRET"),
      });
    },
  );
  it.each([200, 400, 403])(
    "does not reflect free-form error bodies at HTTP %s",
    async (status) => {
      const fake = new FakeZimaOs();
      loginOk(fake);
      fake.on("GET", "/v2/app_management/compose/example", {
        status,
        json: { success: false, message: "syntheticSensitiveMarker" },
      });
      try {
        await makeClient(fake).getComposeApp("example");
        throw new Error("expected upstream failure");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as Error).message).not.toContain("syntheticSensitiveMarker");
      }
    },
  );
  it("unwraps the envelope and returns data for compose list", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("GET", "/v2/app_management/compose", { myapp: { status: "running" } });
    const client = makeClient(fake);

    await expect(client.listComposeApps()).resolves.toEqual({
      myapp: { status: "running" },
    });
  });

  it("maps envelope success=false to ZIMAOS_UPSTREAM_ERROR without its message", async () => {
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

describe("ZimaOsClient.installComposeOnce (mocked HTTP, single real install POST)", () => {
  const INSTALL_PATH =
    "/v2/app_management/compose?dry_run=false&check_port_conflict=true";

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

  /** Establish the existing bearer session without any install traffic. */
  async function withSession(fake: FakeZimaOs): Promise<ZimaOsClient> {
    loginOk(fake);
    const client = makeClient(fake);
    await client.login();
    return client;
  }

  it("uses the existing bearer session (no re-login) and sends exactly one POST on HTTP 200", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: { success: true, message: "app is being installed asynchronously" },
    });
    const { client, urls } = makeRecordingClient(fake);
    // Establish the existing bearer session before any install traffic.
    await client.login();

    // Deliberately awkward source: unicode, comments, quotes, trailing newline.
    const source = 'services:\n  web: # café\n    image: "nginx:1.27"\n';
    const result = await client.installComposeOnce(source);

    expect(result).toEqual({ status: "accepted", accepted: true });
    // Exactly one install POST, to the explicit real-install query (no dry_run=true).
    expect(urls.filter((u) => u.includes("/v2/app_management/compose"))).toHaveLength(1);
    expect(urls[0]).toBe(`${BASE}/v1/users/login`);
    expect(urls[1]).toBe(BASE + INSTALL_PATH);

    const req = fake.calls.find((c) => c.path === "/v2/app_management/compose");
    expect(req?.method).toBe("POST");
    // Exact original string, byte-for-byte (no re-serialization/normalization).
    expect(req?.body).toBe(source);
    expect(req?.headers["content-type"]).toBe("application/yaml");
    expect(req?.headers["authorization"]).toBe("Bearer tok-abc");
    // The pre-existing session was reused: no second login happened.
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
  });

  it("logs in once when no session is held, then still sends exactly one install POST", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 200, json: {} });
    const client = makeClient(fake);

    await expect(client.installComposeOnce("services: {}\n")).resolves.toMatchObject({
      accepted: false, // empty body is not a confirmation of acceptance.
    });
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
  });

  it("timeout after the single attempt -> ZIMAOS_UNREACHABLE, exactly one POST, no retry", async () => {
    const urls: string[] = [];
    // Answers login normally; hangs on the install POST until the client aborts.
    const hangingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/v1/users/login")) {
        return new Response(
          JSON.stringify({ success: true, data: { token: { access_token: "tok-abc" } } }),
          { status: 200 },
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl: hangingFetch,
      timeoutMs: 50,
    });

    await expect(client.installComposeOnce("services: {}\n")).rejects.toMatchObject({
      code: "ZIMAOS_UNREACHABLE",
    });
    // The attempt was made exactly once — a retry after an ambiguous timeout could
    // create a duplicate app (the install POST is not idempotent).
    expect(urls.filter((u) => u.includes("/v2/app_management/compose"))).toHaveLength(1);
  });

  it("HTTP 401 -> ZIMAOS_AUTH_FAILED, exactly one POST, no re-login and no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 401, json: {} });
    const client = await withSession(fake);

    await expect(client.installComposeOnce("services: {}\n")).rejects.toMatchObject({
      code: "ZIMAOS_AUTH_FAILED",
    });
    // The single POST was attempted exactly once; the stale session is dropped, but no
    // re-login and no duplicate install POST happen (a retry would create a second app).
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1); // initial only
  });

  it("HTTP 502 -> upstream_error (ambiguous), exactly one POST, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 502 });
    const client = await withSession(fake);

    const result = await client.installComposeOnce("services:\n  web: 123\n");

    expect(result).toEqual({ status: "upstream_error", accepted: false });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
  });

  it("HTTP 400 -> rejected (definitive), exactly one POST, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 400,
      json: { success: false, message: "port conflict detected" },
    });
    const client = await withSession(fake);

    const result = await client.installComposeOnce(
      'services:\n  web:\n    ports:\n      - "8080:80"\n',
    );

    expect(result).toEqual({ status: "rejected", accepted: false });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
  });

  it("HTTP 403 -> PERMISSION_DENIED, exactly one POST, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 403, json: {} });
    const client = await withSession(fake);

    await expect(client.installComposeOnce("services: {}\n")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
  });

  it("HTTP 429 is rate limiting, not a verdict that Compose was rejected", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", { status: 429, json: {} });
    const client = await withSession(fake);
    await expect(client.installComposeOnce("services: {}\n")).rejects.toMatchObject({
      code: "ZIMAOS_RATE_LIMITED",
    });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(1);
  });

  it("empty/ambiguous responses are never accepted (empty 200, non-JSON 200)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // Empty body: no confirmation of acceptance.
    fake.on("POST", "/v2/app_management/compose", { status: 200 });
    const client = await withSession(fake);

    expect(await client.installComposeOnce("services: {}\n")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    // Non-JSON body: still no confirmation of acceptance.
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      text: "<html>nope</html>",
    });
    expect(await client.installComposeOnce("services: {}\n")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    // Two attempts total — one POST each, no automatic retry of either.
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose"),
    ).toHaveLength(2);
  });

  it("does not accept a 2xx application envelope with success:false", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: { success: false, message: "install failed" },
    });
    const client = await withSession(fake);

    expect(await client.installComposeOnce("services: {}\n")).toEqual({
      status: "rejected",
      accepted: false,
    });
  });

  it("recognizes only the observed message-only HTTP 200 install acceptance", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: { message: "app is being installed asynchronously" },
    });
    const client = await withSession(fake);
    expect(await client.installComposeOnce("services: {}\n")).toEqual({
      status: "accepted",
      accepted: true,
    });
    fake.on("POST", "/v2/app_management/compose", {
      status: 200,
      json: { message: "unknown result" },
    });
    expect(await client.installComposeOnce("services: {}\n")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
  });

  it("never reflects upstream messages or secrets in the acceptance result", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    const source =
      "services:\n  web:\n    environment:\n      API_KEY: secret-sentinel\n";
    fake.on("POST", "/v2/app_management/compose", {
      status: 502,
      text: "boom: secret-sentinel echoed by upstream",
    });
    const client = await withSession(fake);

    const result = await client.installComposeOnce(source);
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    expect(result).toEqual({ status: "upstream_error", accepted: false });
  });
});

describe("ZimaOsClient.uninstallComposeOnce (mocked HTTP, single real uninstall DELETE)", () => {
  const UNINSTALL_PATH = "/v2/app_management/compose/myapp?delete_config_folder=false";

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

  /** Establish the existing bearer session without any uninstall traffic. */
  async function withSession(fake: FakeZimaOs): Promise<ZimaOsClient> {
    loginOk(fake);
    const client = makeClient(fake);
    await client.login();
    return client;
  }

  it("validates a missing/blank id before any network traffic (no login, no DELETE)", async () => {
    const fake = new FakeZimaOs();
    // No routes registered at all: any request would fail the test.
    const client = makeClient(fake);

    await expect(client.uninstallComposeOnce("")).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    await expect(client.uninstallComposeOnce("   ")).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    // Nothing was sent — not even a login.
    expect(fake.calls).toHaveLength(0);
  });

  it("uses the existing bearer session (no re-login) and sends exactly one DELETE on HTTP 200 success:true", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 200,
      json: { success: true, message: "app is being uninstalled asynchronously" },
    });
    const { client, urls } = makeRecordingClient(fake);
    // Establish the existing bearer session before any uninstall traffic.
    await client.login();

    const result = await client.uninstallComposeOnce("myapp");

    expect(result).toEqual({ status: "accepted", accepted: true });
    // Exactly one DELETE, to the explicit non-destructive query (no dry-run flags).
    expect(urls.filter((u) => u.includes("/v2/app_management/compose"))).toHaveLength(1);
    expect(urls[0]).toBe(`${BASE}/v1/users/login`);
    expect(urls[1]).toBe(BASE + UNINSTALL_PATH);

    const req = fake.calls.find((c) => c.path === "/v2/app_management/compose/myapp");
    expect(req?.method).toBe("DELETE");
    // No request body on a DELETE.
    expect(req?.body).toBeUndefined();
    expect(req?.headers["authorization"]).toBe("Bearer tok-abc");
    // The pre-existing session was reused: no second login happened.
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
  });

  it("URL-encodes the id in the path (no raw special characters on the wire)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // encodeURIComponent("a/b?c") === "a%2Fb%3Fc": neither / nor ? may reach the wire.
    fake.on("DELETE", "/v2/app_management/compose/a%2Fb%3Fc", {
      status: 200,
      json: { success: true },
    });
    const client = await withSession(fake);

    const result = await client.uninstallComposeOnce("a/b?c");

    expect(result).toEqual({ status: "accepted", accepted: true });
    // The encoded id is what reaches the wire; the raw form never does.
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/a%2Fb%3Fc"),
    ).toHaveLength(1);
  });

  it("logs in once when no session is held, then still sends exactly one DELETE", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 200 });
    const client = makeClient(fake);

    await expect(client.uninstallComposeOnce("myapp")).resolves.toMatchObject({
      accepted: false, // empty body is not a confirmation of acceptance.
    });
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(1);
  });

  it("timeout after the single attempt -> ZIMAOS_UNREACHABLE, exactly one DELETE, no retry", async () => {
    const urls: string[] = [];
    // Answers login normally; hangs on the uninstall DELETE until the client aborts.
    const hangingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/v1/users/login")) {
        return new Response(
          JSON.stringify({ success: true, data: { token: { access_token: "tok-abc" } } }),
          { status: 200 },
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl: hangingFetch,
      timeoutMs: 50,
    });

    await expect(client.uninstallComposeOnce("myapp")).rejects.toMatchObject({
      code: "ZIMAOS_UNREACHABLE",
    });
    // The attempt was made exactly once — a retry after an ambiguous timeout could
    // race or repeat a destructive removal.
    expect(urls.filter((u) => u.includes("/v2/app_management/compose"))).toHaveLength(1);
  });

  it("HTTP 401 -> ZIMAOS_AUTH_FAILED, exactly one DELETE, no re-login and no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 401, json: {} });
    const client = await withSession(fake);

    await expect(client.uninstallComposeOnce("myapp")).rejects.toMatchObject({
      code: "ZIMAOS_AUTH_FAILED",
    });
    // The single DELETE was attempted exactly once; the stale session is dropped, but no
    // re-login and no duplicate DELETE happen (a retry could race a running removal).
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(1);
    expect(fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1); // initial only
  });

  it("HTTP 404 (missing app) -> rejected (definitive), exactly one DELETE, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/ghost", { status: 404, json: {} });
    const client = await withSession(fake);

    const result = await client.uninstallComposeOnce("ghost");

    expect(result).toEqual({ status: "rejected", accepted: false });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/ghost"),
    ).toHaveLength(1);
  });

  it("HTTP 502 -> upstream_error (ambiguous), exactly one DELETE, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 502 });
    const client = await withSession(fake);

    const result = await client.uninstallComposeOnce("myapp");

    expect(result).toEqual({ status: "upstream_error", accepted: false });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(1);
  });

  it("HTTP 403 -> PERMISSION_DENIED, exactly one DELETE, no retry", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 403, json: {} });
    const client = await withSession(fake);

    await expect(client.uninstallComposeOnce("myapp")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(1);
  });

  it("HTTP 429 is rate limiting, not a verdict that the uninstall was rejected", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 429, json: {} });
    const client = await withSession(fake);
    await expect(client.uninstallComposeOnce("myapp")).rejects.toMatchObject({
      code: "ZIMAOS_RATE_LIMITED",
    });
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(1);
  });

  it("empty/ambiguous responses are never accepted (empty 200, non-JSON 200)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // Empty body: no confirmation of acceptance.
    fake.on("DELETE", "/v2/app_management/compose/myapp", { status: 200 });
    const client = await withSession(fake);

    expect(await client.uninstallComposeOnce("myapp")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    // Non-JSON body: still no confirmation of acceptance.
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 200,
      text: "<html>nope</html>",
    });
    expect(await client.uninstallComposeOnce("myapp")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    // Two attempts total — one DELETE each, no automatic retry of either.
    expect(
      fake.calls.filter((c) => c.path === "/v2/app_management/compose/myapp"),
    ).toHaveLength(2);
  });

  it("does not accept a 2xx application envelope with success:false", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 200,
      json: { success: false, message: "uninstall failed" },
    });
    const client = await withSession(fake);

    expect(await client.uninstallComposeOnce("myapp")).toEqual({
      status: "rejected",
      accepted: false,
    });
  });

  it("recognizes only the observed message-only HTTP 200 uninstall acceptance", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 200,
      json: { message: "app is being uninstalled asynchronously" },
    });
    const client = await withSession(fake);
    expect(await client.uninstallComposeOnce("myapp")).toEqual({
      status: "accepted",
      accepted: true,
    });
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 200,
      json: { message: "unknown result" },
    });
    expect(await client.uninstallComposeOnce("myapp")).toEqual({
      status: "upstream_error",
      accepted: false,
    });
  });

  it("never reflects upstream messages or secrets in the result (401/5xx bodies)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // A 5xx with a hostile body must not leak into the fixed-shape result.
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 502,
      text: "boom: secret-sentinel echoed by upstream",
    });
    const client = await withSession(fake);

    const result = await client.uninstallComposeOnce("myapp");
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    expect(result).toEqual({ status: "upstream_error", accepted: false });

    // A 401 with a hostile body throws a sanitized AppError, not the upstream text.
    fake.on("DELETE", "/v2/app_management/compose/myapp", {
      status: 401,
      json: { message: "token secret-sentinel invalid" },
    });
    const err = await client.uninstallComposeOnce("myapp").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "ZIMAOS_AUTH_FAILED" });
    expect(JSON.stringify(err)).not.toContain("secret-sentinel");
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });
});
