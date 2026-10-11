/**
 * Bounded authenticated read-only store search transport (Phase 7 slice).
 *
 * Mocked HTTP only (no live VM). Covers:
 * - exact endpoint, query-string filtering/encoding (URLSearchParams), bearer
 *   auth, and GET-only traffic (the only other request is the login);
 * - input validation BEFORE any traffic: zero fetch calls for every
 *   invalid query / repoIds / page input;
 * - the outer envelope is returned unwrapped, and success:false or
 *   non-record bodies fail closed with sanitized errors;
 * - shared transport behavior reused with focused negatives: stale-401 retry
 *   exactly once, redirect rejected, oversize body rejected.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ZimaOsClient } from "../src/zimaos/client.js";

const BASE = "http://zimaos.test:8080";
const TOKEN = "tok-abc";
const SEARCH_PATH = "/v3/app_store/hub/app/search";

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

function loginResponse() {
  return Response.json({
    success: true,
    data: { token: { access_token: TOKEN, refresh_token: "r" } },
  });
}

function searchEnvelope(extra?: Record<string, unknown>) {
  return {
    success: true,
    data: {
      total: 1,
      apps: [{ repo_id: "zimaos@v2", id: "com.example.app", type: "compose" }],
    },
    page: 2,
    page_size: 60,
    ...extra,
  };
}

// The helper below cannot close over its own call count, so it is built inline in tests.
function recordSearchHandler(responder: (searchCallIndex: number) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let searchCount = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/users/login")) return loginResponse();
    const index = searchCount;
    searchCount += 1;
    return responder(index);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("ZimaOsClient.getStoreSearchPage (mocked HTTP)", () => {
  it("builds the exact encoded search URL, sends GET with the bearer token, and returns the outer envelope", async () => {
    const { fetchImpl, calls } = recordSearchHandler(() =>
      Response.json(searchEnvelope()),
    );
    const client = clientWith(fetchImpl);

    const envelope = await client.getStoreSearchPage(
      "  café & tools  ",
      ["zimaos@v2", "community@v1"],
      2,
    );

    // The OUTER envelope is returned (pagination/status intact), not unwrapped.
    expect(envelope).toEqual(searchEnvelope());
    expect(Object.keys(envelope as Record<string, unknown>)).toContain("page_size");
    expect(Object.keys(envelope as Record<string, unknown>)).toContain("page");

    const search = calls.find((c) => c.url.startsWith(`${BASE}${SEARCH_PATH}`));
    expect(search).toBeDefined();
    // Exact URLSearchParams encoding: q is the TRIMMED literal text; '@' and
    // ',' in repo_ids are percent-encoded; fixed locale/page/page_size/types.
    expect(search?.url).toBe(
      `${BASE}${SEARCH_PATH}?q=caf%C3%A9+%26+tools` +
        `&locale=en_us&page=2&page_size=60` +
        `&repo_ids=zimaos%40v2%2Ccommunity%40v1&types=compose`,
    );
    expect(search?.init?.method).toBe("GET");
    expect(search?.init?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
    );
  });

  it("sends only a login POST plus a single search GET (no other traffic)", async () => {
    const { fetchImpl, calls } = recordSearchHandler(() =>
      Response.json(searchEnvelope()),
    );
    await clientWith(fetchImpl).getStoreSearchPage("tools", ["zimaos@v2"], 1);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`${BASE}/v1/users/login`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.url.startsWith(`${BASE}${SEARCH_PATH}`)).toBe(true);
    expect(calls[1]?.init?.method).toBe("GET");
    for (const call of calls) {
      expect(["POST", "GET"]).toContain(call.init?.method);
    }
  });

  it.each([
    ["blank query", "   ", ["r@v1"], 1],
    ["non-string query", 123, ["r@v1"], 1],
    ["query over raw 256 chars", "a".repeat(257), ["r@v1"], 1],
    ["control character in query", "a\nb", ["r@v1"], 1],
    ["repoIds not an array", "q", "not-an-array", 1],
    ["empty repoIds", "q", [], 1],
    [
      "too many repoIds (129)",
      "q",
      Array.from({ length: 129 }, (_, i) => `repo${i}@v1`),
      1,
    ],
    ["non-string repoId", "q", ["zimaos@v2", 42], 1],
    ["unsafe repoId", "q", ["../../etc/passwd"], 1],
    ["duplicate repoId (case-insensitive)", "q", ["zimaos@v2", "ZIMAOS@V2"], 1],
    ["page below 1", "q", ["zimaos@v2"], 0],
    ["page above 5", "q", ["zimaos@v2"], 6],
    ["non-integer page", "q", ["zimaos@v2"], 1.5],
  ])(
    "rejects invalid input BEFORE any traffic (zero requests): %s",
    async (_name, query, repoIds, page) => {
      const { fetchImpl, calls } = recordSearchHandler(() =>
        Response.json(searchEnvelope()),
      );
      const client = clientWith(fetchImpl);

      await expectAppError(
        client.getStoreSearchPage(
          query as string,
          repoIds as readonly string[],
          page as number,
        ),
        "INPUT_INVALID",
      );
      // No login, no search: validation happens before any network traffic.
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects a success:false envelope with a sanitized error (no payload reflection)", async () => {
    const { fetchImpl } = recordSearchHandler(() =>
      Response.json({ success: false, message: "SYNTHETIC_SECRET_TOKEN" }),
    );
    const client = clientWith(fetchImpl);

    const err = await expectAppError(
      client.getStoreSearchPage("tools", ["zimaos@v2"], 1),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expect(err.message).not.toContain("SYNTHETIC_SECRET_TOKEN");
  });

  it("rejects a non-record JSON body with a sanitized error", async () => {
    const { fetchImpl } = recordSearchHandler(() => Response.json(42));
    const client = clientWith(fetchImpl);

    await expectAppError(
      client.getStoreSearchPage("tools", ["zimaos@v2"], 1),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("retries a stale 401 exactly once (fresh login path)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let loginCount = 0;
    let searchCount = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/users/login")) {
        loginCount += 1;
        return Response.json({
          success: true,
          data: { token: { access_token: `tok-${loginCount}`, refresh_token: "r" } },
        });
      }
      searchCount += 1;
      if (searchCount === 1) return new Response(null, { status: 401 });
      return Response.json(searchEnvelope());
    }) as typeof fetch;
    const client = clientWith(fetchImpl);

    expect(await client.getStoreSearchPage("tools", ["zimaos@v2"], 1)).toEqual(
      searchEnvelope(),
    );
    expect(loginCount).toBe(2);
    const searches = calls.filter((c) => c.url.startsWith(`${BASE}${SEARCH_PATH}`));
    expect(searches).toHaveLength(2); // original + exactly one retry, no third
    expect(searches[1]?.init?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer tok-2" }),
    );
  });

  it("rejects a redirect with a sanitized error and does not follow it (shared transport)", async () => {
    const { fetchImpl, calls } = recordSearchHandler(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://evil.example/steal" },
        }),
    );
    const client = clientWith(fetchImpl);

    const err = await expectAppError(
      client.getStoreSearchPage("tools", ["zimaos@v2"], 1),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expect(err.message).not.toContain("evil.example");
    const searches = calls.filter((c) => c.url.startsWith(`${BASE}${SEARCH_PATH}`));
    expect(searches).toHaveLength(1); // exactly one attempt, no follow
  });

  it("rejects an oversize (>4 MiB) body with a sanitized error (shared transport)", async () => {
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    const { fetchImpl } = recordSearchHandler(() => new Response(big, { status: 200 }));
    const client = clientWith(fetchImpl);

    await expectAppError(
      client.getStoreSearchPage("tools", ["zimaos@v2"], 1),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });
});
