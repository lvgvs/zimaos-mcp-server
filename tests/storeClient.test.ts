/**
 * Bounded authenticated native catalog READ transport (Phase 6 slice).
 *
 * Mocked HTTP only (no live VM). Covers:
 * - exact endpoints, query strings, and bearer auth;
 * - malicious selection/detail rejection BEFORE any catalog traffic;
 * - redirects rejected (no follow);
 * - stream-bound bodies (4 MiB JSON, 512 KiB YAML) with reader cancel;
 * - strict UTF-8 decoding; YAML returned unchanged;
 * - malformed payloads and sanitized errors;
 * - read-only stale-401 retry exactly once via the existing auth path.
 */
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";
import type { StoreDetail, StoreSelection } from "../src/zimaos/storeCatalog.js";

const BASE = "http://zimaos.test:8080";
const TOKEN = "tok-abc";

function makeClient(fake: FakeZimaOs, timeoutMs = 5_000): ZimaOsClient {
  return new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl: fake.fetchImpl,
    timeoutMs,
  });
}

function loginOk(fake: FakeZimaOs): void {
  fake.on("POST", "/v1/users/login", {
    json: {
      success: true,
      message: "ok",
      data: { token: { access_token: TOKEN, refresh_token: "ref" } },
    },
  });
}

function appRequests(_client: ZimaOsClient, fake: FakeZimaOs): typeof fake.calls {
  return fake.calls.filter(
    (call) => call.path.startsWith("/v3/") || call.path.startsWith("/v2/"),
  );
}

/** Records FULL request URLs (query strings included) for exact endpoint assertions. */
function recordFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function clientWith(fetchImpl: typeof fetch, timeoutMs = 5_000): ZimaOsClient {
  return new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl,
    timeoutMs,
  });
}

async function expectAppError(
  promise: Promise<unknown>,
  code: string,
): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      expect(err.code).toBe(code);
      return err;
    }
    throw new Error(`Expected AppError ${code}, got: ${String(err)}`);
  }
  throw new Error(`Expected AppError ${code}, but the promise resolved`);
}

const SELECTION: StoreSelection = { repoId: "zimaos@v2", appId: "com.example.app" };

const DETAIL: StoreDetail = {
  repoId: "zimaos@v2",
  appId: "com.example.app",
  architecture: "amd64",
  composePath: "/apps/com.example.app/docker-compose.amd64.yml",
};

// ---------------------------------------------------------------------------
// getStoreRepositories — GET /v3/app_store/repo (envelope data)
// ---------------------------------------------------------------------------

describe("ZimaOsClient.getStoreRepositories (mocked HTTP)", () => {
  it("GETs /v3/app_store/repo with the bearer token and returns the unwrapped data", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("GET", "/v3/app_store/repo", [
      { id: "r1", enabled: true, version: "v2", transport: "http" },
    ]);
    const client = makeClient(fake);

    const data = await client.getStoreRepositories();

    expect(data).toEqual([{ id: "r1", enabled: true, version: "v2", transport: "http" }]);
    const req = appRequests(client, fake).find((c) => c.path === "/v3/app_store/repo");
    expect(req?.method).toBe("GET");
    expect(req?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("rejects a success:false envelope with a sanitized error (no payload content)", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on("GET", "/v3/app_store/repo", {
      json: { success: false, message: "SYNTHETIC_SECRET_TOKEN" },
    });
    const client = makeClient(fake);

    const err = await expectAppError(
      client.getStoreRepositories(),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expect(err.message).not.toContain("SYNTHETIC_SECRET_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// getAppManagementArchitecture — bare GET /v2/app_management/info
// ---------------------------------------------------------------------------

describe("ZimaOsClient.getAppManagementArchitecture (mocked HTTP)", () => {
  it("returns the architecture field from the bare (unwrapped) payload", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.raw("GET", "/v2/app_management/info", { architecture: "arm64" });
    const client = makeClient(fake);

    expect(await client.getAppManagementArchitecture()).toBe("arm64");
    const req = appRequests(client, fake).find(
      (c) => c.path === "/v2/app_management/info",
    );
    expect(req?.method).toBe("GET");
    expect(req?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ["not a record", "plain-text" as unknown],
    ["missing field", { unrelated: "x" }],
    ["non-string field", { architecture: 42 }],
    ["unsupported value", { architecture: "arm32" }],
    ["empty string", { architecture: "" }],
  ])(
    "fails closed (ZIMAOS_UPSTREAM_ERROR) when malformed: %s",
    async (_name, payload) => {
      const fake = new FakeZimaOs();
      loginOk(fake);
      fake.on("GET", "/v2/app_management/info", { json: payload });
      const client = makeClient(fake);

      await expectAppError(
        client.getAppManagementArchitecture(),
        "ZIMAOS_UPSTREAM_ERROR",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// getStoreAppDetail — validated pair, GET /v3/app_store/hub/repo/{repo}/app/{app}?locale=en_us
// ---------------------------------------------------------------------------

describe("ZimaOsClient.getStoreAppDetail (mocked HTTP)", () => {
  it("builds the exact encoded endpoint with ?locale=en_us and returns the unwrapped data", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.ok("GET", "/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app", {
      id: "com.example.app",
    });
    const client = makeClient(fake);

    const data = await client.getStoreAppDetail(SELECTION);

    expect(data).toEqual({ id: "com.example.app" });
    const req = appRequests(client, fake)[0];
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe("/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app");
    expect(req?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("preserves the query string exactly (proved with a full-URL recorder)", async () => {
    const { fetchImpl, calls } = recordFetch((url) => {
      const u = new URL(url);
      if (u.pathname === "/v1/users/login") {
        return new Response(
          JSON.stringify({
            success: true,
            data: { token: { access_token: TOKEN, refresh_token: "ref" } },
          }),
        );
      }
      return new Response(JSON.stringify({ success: true, data: { id: "x" } }));
    });
    const client = clientWith(fetchImpl);
    await client.getStoreAppDetail(SELECTION);

    const detailCall = calls.find((c) => c.url.includes("/v3/app_store/hub/repo/"));
    expect(detailCall?.url).toBe(
      `${BASE}/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app?locale=en_us`,
    );
  });

  it.each([
    ["path traversal in repoId", { repoId: "../../etc/passwd", appId: "a.b" }],
    ["path traversal in appId", { repoId: "r1", appId: "../../etc/passwd" }],
    ["absolute URL in appId", { repoId: "r1", appId: "http://evil.example/a.b" }],
    ["missing fields", { repoId: "r1" } as StoreSelection],
    [
      "extra key rejected",
      { repoId: "r1", appId: "a.b", url: "http://evil.example" } as StoreSelection,
    ],
    ["non-object selection", null as unknown as StoreSelection],
    ["empty repoId", { repoId: "", appId: "a.b" }],
    ["uppercase appId", { repoId: "r1", appId: "a.B" }],
    ["single-segment appId", { repoId: "r1", appId: "nodots" }],
  ])(
    "rejects a malicious selection BEFORE any catalog traffic: %s",
    async (_name, selection) => {
      const fake = new FakeZimaOs();
      // No login route at all: any network attempt would make the fake throw.
      const client = makeClient(fake);

      await expectAppError(client.getStoreAppDetail(selection), "INPUT_INVALID");
      expect(appRequests(client, fake)).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// getStoreCompose — validated detail, proxy endpoint, YAML unchanged
// ---------------------------------------------------------------------------

describe("ZimaOsClient.getStoreCompose (mocked HTTP)", () => {
  const yaml = 'services:\n  app:\n    image: "example/app:1"\n';

  it("uses the same canonical pair validation as detail resolution", async () => {
    const numeric = {
      ...DETAIL,
      appId: "1.example.app",
      composePath: "/apps/1.example.app/docker-compose.amd64.yml",
    };
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on(
      "GET",
      "/v3/app_store/repo/proxy/zimaos%40v2/apps/1.example.app/docker-compose.amd64.yml",
      { text: yaml },
    );
    expect(await makeClient(fake).getStoreCompose(numeric)).toBe(yaml);
    for (const repoId of ["repo@@id", "repo."]) {
      const isolated = new FakeZimaOs();
      await expectAppError(
        makeClient(isolated).getStoreCompose({ ...DETAIL, repoId }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      expect(isolated.calls).toHaveLength(0);
    }
    const appId = `com.${"a".repeat(190)}`;
    await expectAppError(
      makeClient(new FakeZimaOs()).getStoreCompose({
        ...DETAIL,
        appId,
        composePath: `/apps/${appId}/docker-compose.amd64.yml`,
      }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("GETs the exact proxy endpoint (encoded repoId + verified composePath) and returns the YAML unchanged", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    fake.on(
      "GET",
      "/v3/app_store/repo/proxy/zimaos%40v2/apps/com.example.app/docker-compose.amd64.yml",
      {
        text: yaml,
      },
    );
    const client = makeClient(fake);

    expect(await client.getStoreCompose(DETAIL)).toBe(yaml);
    const req = appRequests(client, fake)[0];
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe(
      "/v3/app_store/repo/proxy/zimaos%40v2/apps/com.example.app/docker-compose.amd64.yml",
    );
    expect(req?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ["traversal composePath", { ...DETAIL, composePath: "/apps/../../etc/passwd" }],
    [
      "wrong app composePath",
      { ...DETAIL, composePath: "/apps/com.other.app/docker-compose.amd64.yml" },
    ],
    ["absolute URL composePath", { ...DETAIL, composePath: "http://evil.example/x.yml" }],
    [
      "missing .yml suffix",
      { ...DETAIL, composePath: "/apps/com.example.app/docker-compose.amd64" },
    ],
    [
      "wrong extension",
      { ...DETAIL, composePath: "/apps/com.example.app/docker-compose.amd64.yaml" },
    ],
    ["unsupported architecture", { ...DETAIL, architecture: "arm32" }],
    ["arch/path mismatch", { ...DETAIL, architecture: "arm64" }],
    ["non-object detail", null as unknown as StoreDetail],
    ["traversal repoId", { ...DETAIL, repoId: "..%2F..%2Fetc" }],
  ])(
    "rejects a malicious detail BEFORE any catalog traffic: %s",
    async (_name, detail) => {
      const fake = new FakeZimaOs();
      const client = makeClient(fake);

      await expectAppError(client.getStoreCompose(detail), "ZIMAOS_UPSTREAM_ERROR");
      expect(appRequests(client, fake)).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Transport hardening: redirects, stream bounds, UTF-8, errors, timeout, retry
// ---------------------------------------------------------------------------

describe("native read transport hardening (mocked HTTP)", () => {
  const loginResponse = () =>
    Response.json({
      success: true,
      data: { token: { access_token: TOKEN, refresh_token: "r" } },
    });

  it("cancels bodies rejected before streaming without waiting on cancellation", async () => {
    for (const mode of ["length", "status", "redirect"] as const) {
      let cancelled = false;
      const { fetchImpl } = recordFetch((url) => {
        if (url.endsWith("/v1/users/login")) return loginResponse();
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
              return new Promise<void>(() => {});
            },
          }),
          {
            status: mode === "status" ? 503 : mode === "redirect" ? 302 : 200,
            headers: mode === "length" ? { "content-length": "524289" } : {},
          },
        );
      });
      await expectAppError(
        clientWith(fetchImpl, 20).getStoreCompose(DETAIL),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      expect(cancelled).toBe(true);
    }
  });

  it("removes abort listeners after every completed streaming read", async () => {
    let adds: ReturnType<typeof vi.spyOn> | undefined;
    let removes: ReturnType<typeof vi.spyOn> | undefined;
    const { fetchImpl } = recordFetch((url, init) => {
      if (url.endsWith("/v1/users/login")) return loginResponse();
      const signal = init?.signal as AbortSignal;
      adds = vi.spyOn(signal, "addEventListener");
      removes = vi.spyOn(signal, "removeEventListener");
      let remaining = 30;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (remaining-- > 0) controller.enqueue(new TextEncoder().encode("x"));
            else controller.close();
          },
        }),
      );
    });
    expect(await clientWith(fetchImpl).getStoreCompose(DETAIL)).toBe("x".repeat(30));
    expect(adds?.mock.calls.length).toBe(removes?.mock.calls.length);
    vi.restoreAllMocks();
  });

  it("cancels a stalled reader and clears its timer on timeout", async () => {
    let cancelled = false;
    const timer = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response(
            new ReadableStream({
              pull() {},
              cancel() {
                cancelled = true;
              },
            }),
          ),
    );
    try {
      await expectAppError(
        clientWith(fetchImpl, 10).getStoreCompose(DETAIL),
        "ZIMAOS_UNREACHABLE",
      );
      expect(cancelled).toBe(true);
      expect(clear.mock.calls.length).toBe(timer.mock.calls.length);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("preserves UTF-8 BOM, non-ASCII and CRLF bytes in downloaded YAML", async () => {
    const yaml = "\ufeffname: example\r\n# café 💡\r\nservices: {}\r\n";
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response(new TextEncoder().encode(yaml)),
    );
    expect(await clientWith(fetchImpl).getStoreCompose(DETAIL)).toBe(yaml);
  });
  it("rejects redirects with a sanitized error and does not follow them", async () => {
    const { fetchImpl, calls } = recordFetch((url) => {
      if (url.endsWith("/v1/users/login")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { token: { access_token: TOKEN, refresh_token: "r" } },
          }),
        );
      }
      return new Response(null, {
        status: 302,
        headers: { location: "http://evil.example/steal" },
      });
    });
    const client = clientWith(fetchImpl);

    const err = await expectAppError(
      client.getStoreRepositories(),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expect(err.message).not.toContain("evil.example");
    const redirected = calls.filter((c) => c.url.endsWith("/v3/app_store/repo"));
    expect(redirected).toHaveLength(1); // exactly one attempt, no follow
  });

  it("bounds the JSON body at 4 MiB and cancels the reader on overflow", async () => {
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response(big, { status: 200 }),
    );
    const client = clientWith(fetchImpl);

    await expectAppError(client.getStoreRepositories(), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("bounds the YAML body at 512 KiB and cancels the reader on overflow", async () => {
    const big = "y".repeat(512 * 1024 + 1);
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response(big, { status: 200 }),
    );
    const client = clientWith(fetchImpl);

    await expectAppError(client.getStoreCompose(DETAIL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects invalid UTF-8 bytes with a sanitized error", async () => {
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response(new Uint8Array([0xff, 0xfe, 0x27, 0x22]), { status: 200 }),
    );
    const client = clientWith(fetchImpl);

    const err = await expectAppError(
      client.getStoreCompose(DETAIL),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expect(err.message).not.toContain("\ufffd");
  });

  it("rejects a non-JSON body on a JSON endpoint with a sanitized error", async () => {
    const { fetchImpl } = recordFetch((url) =>
      url.endsWith("/v1/users/login")
        ? loginResponse()
        : new Response("not-json", { status: 200 }),
    );
    const client = clientWith(fetchImpl);

    await expectAppError(client.getStoreRepositories(), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects an empty YAML body", () => {
    const { fetchImpl } = recordFetch((url) => {
      if (url.endsWith("/v1/users/login")) {
        return Response.json({
          success: true,
          data: { token: { access_token: "tok", refresh_token: "ref" } },
        });
      }
      return new Response("", { status: 200 });
    });
    const client = clientWith(fetchImpl);

    return expectAppError(client.getStoreCompose(DETAIL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("maps 404/503 to sanitized AppErrors", async () => {
    for (const [status, code] of [
      [404, "ZIMAOS_NOT_FOUND"],
      [503, "ZIMAOS_UPSTREAM_ERROR"],
    ] as const) {
      const { fetchImpl } = recordFetch((url) =>
        url.endsWith("/v1/users/login")
          ? loginResponse()
          : new Response("err", { status }),
      );
      const client = clientWith(fetchImpl);
      await expectAppError(client.getStoreRepositories(), code);
    }
  });

  it("times out until the body is complete (timer covers streaming, not just headers)", async () => {
    const { fetchImpl } = recordFetch((url) => {
      if (url.endsWith("/v1/users/login")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { token: { access_token: TOKEN, refresh_token: "r" } },
          }),
        );
      }
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          // One byte, then hang forever: the read never completes.
          if (!(this as unknown as { started?: boolean }).started) {
            (this as unknown as { started?: boolean }).started = true;
            controller.enqueue(encoder.encode("["));
          }
        },
      });
      return new Response(body, { status: 200 });
    });
    const client = clientWith(fetchImpl, 150);

    const err = await expectAppError(client.getStoreRepositories(), "ZIMAOS_UNREACHABLE");
    expect(err.message).toContain("Timed out");
  });

  it("network failures surface as sanitized ZIMAOS_UNREACHABLE errors", async () => {
    const { fetchImpl } = recordFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const client = clientWith(fetchImpl);

    await expectAppError(client.getStoreRepositories(), "ZIMAOS_UNREACHABLE");
  });

  it("retries a read-only GET exactly once after a stale 401 (fresh login path)", async () => {
    const fake = new FakeZimaOs();
    // Login #1, then a login #2 for the retry.
    fake.on("POST", "/v1/users/login", {
      json: {
        success: true,
        data: { token: { access_token: "tok-1", refresh_token: "r" } },
      },
    });
    fake.on("POST", "/v1/users/login", {
      json: {
        success: true,
        data: { token: { access_token: "tok-2", refresh_token: "r" } },
      },
    });
    fake.on("GET", "/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app", {
      status: 401,
    });
    fake.on("GET", "/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app", {
      json: { success: true, data: { id: "com.example.app" } },
    });
    const client = makeClient(fake);

    expect(await client.getStoreAppDetail(SELECTION)).toEqual({ id: "com.example.app" });
    const logins = fake.calls.filter((c) => c.path === "/v1/users/login");
    expect(logins).toHaveLength(2);
    const detailCalls = fake.calls.filter(
      (c) => c.path === "/v3/app_store/hub/repo/zimaos%40v2/app/com.example.app",
    );
    expect(detailCalls).toHaveLength(2);
    expect(detailCalls[1]?.headers["authorization"]).toBe("Bearer tok-2");
  });

  it("does NOT retry a second 401 (retry budget is one)", async () => {
    const fake = new FakeZimaOs();
    fake.on("POST", "/v1/users/login", {
      json: {
        success: true,
        data: { token: { access_token: "tok-1", refresh_token: "r" } },
      },
    });
    fake.on("POST", "/v1/users/login", {
      json: {
        success: true,
        data: { token: { access_token: "tok-2", refresh_token: "r" } },
      },
    });
    fake.on("GET", "/v3/app_store/repo", { status: 401 });
    fake.on("GET", "/v3/app_store/repo", { status: 401 });
    const client = makeClient(fake);

    await expectAppError(client.getStoreRepositories(), "ZIMAOS_AUTH_FAILED");
    const repos = fake.calls.filter((c) => c.path === "/v3/app_store/repo");
    expect(repos).toHaveLength(2); // original + exactly one retry, no third
  });
});
