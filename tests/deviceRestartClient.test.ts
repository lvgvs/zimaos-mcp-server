import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";

/**
 * Fixed one-shot device restart client: PUT /v1/sys/state/restart, no body,
 * authenticated, 64 KiB JSON bound, never retried. Accepted ONLY on an HTTP
 * 200 JSON envelope with success exactly true or 200 AND data exactly
 * "The operation will be completed shortly." Everything else is the fixed
 * unknown result; pre-mutation login failures still throw with zero PUTs.
 */
const ASYNC_PHRASE = "The operation will be completed shortly.";
const UNK = {
  status: "unknown",
  accepted: false,
  completion: "unverified",
  retrySafe: false,
};

type Call = { url: string; init?: RequestInit };

function clientWith(
  route: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const calls: Call[] = [];
  const client = new ZimaOsClient({
    baseUrl: "http://example.test",
    username: "test",
    password: "synthetic-password",
    timeoutMs: 200,
    fetchImpl: (async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/users/login")) {
        return Response.json({
          success: true,
          data: { token: { access_token: "synthetic-token" } },
        });
      }
      return route(url, init);
    }) as typeof fetch,
  });
  return { client, calls };
}

const putCalls = (calls: Call[]) =>
  calls.filter((c) => c.url.endsWith("/v1/sys/state/restart"));
const loginCalls = (calls: Call[]) =>
  calls.filter((c) => c.url.endsWith("/v1/users/login"));

function assertUnknown(result: unknown, calls: Call[]) {
  expect(result).toEqual(UNK);
  expect(putCalls(calls)).toHaveLength(1);
  expect(loginCalls(calls)).toHaveLength(1); // login only before the single PUT
  const exposed = JSON.stringify(result);
  expect(exposed).not.toContain("synthetic-token");
  expect(exposed).not.toContain("synthetic-password");
}

describe("restartDeviceOnce fixed one-shot restart client", () => {
  it("logs in when no session, sends exactly one PUT with no body and no redirect-follow, and accepts an HTTP 200 success:true envelope", async () => {
    const { client, calls } = clientWith(() =>
      Response.json(
        { success: true, message: "ok", data: ASYNC_PHRASE },
        { status: 200 },
      ),
    );
    expect(await client.restartDeviceOnce()).toEqual({
      status: "accepted",
      accepted: true,
      completion: "unverified",
      retrySafe: false,
    });
    expect(loginCalls(calls)).toHaveLength(1);
    const put = putCalls(calls);
    expect(put).toHaveLength(1);
    expect(put[0]?.url).toBe("http://example.test/v1/sys/state/restart");
    expect(put[0]?.init?.method).toBe("PUT");
    expect(put[0]?.init?.body).toBeUndefined();
    expect(put[0]?.init?.redirect).toBe("manual");
    expect(put[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer synthetic-token",
    });
  });

  it("accepts the HTTP 200 numeric-success envelope with the exact async phrase", async () => {
    const { client, calls } = clientWith(() =>
      Response.json({ success: 200, data: ASYNC_PHRASE }, { status: 200 }),
    );
    expect(await client.restartDeviceOnce()).toEqual({
      status: "accepted",
      accepted: true,
      completion: "unverified",
      retrySafe: false,
    });
    expect(putCalls(calls)).toHaveLength(1);
  });

  it("treats success:false with the async phrase as unknown", async () => {
    const { client, calls } = clientWith(() =>
      Response.json({ success: false, data: ASYNC_PHRASE }, { status: 200 }),
    );
    assertUnknown(await client.restartDeviceOnce(), calls);
  });

  it.each([
    ["missing-success", { data: ASYNC_PHRASE }],
    ["missing-phrase", { success: true }],
    ["wrong-phrase", { success: true, data: "restarting" }],
    ["wrong-number", { success: 201, data: ASYNC_PHRASE }],
    ["true", { data: "true" }],
    ["1", { data: 1 }],
    ["1.0", { data: 1.0 }],
    ["string-1", { data: "1" }],
    ["phrase-only", { data: ASYNC_PHRASE, success: "true" }],
  ])(
    "treats numeric/nearby-looking success flags as unknown (%s)",
    async (_, envelope) => {
      const { client, calls } = clientWith(() =>
        Response.json(envelope, { status: 200 }),
      );
      assertUnknown(await client.restartDeviceOnce(), calls);
    },
  );

  it("treats unknown messages as unknown", async () => {
    for (const data of [
      "restarting",
      ASYNC_PHRASE + " ",
      ASYNC_PHRASE.toUpperCase(),
      null,
    ]) {
      const { client, calls } = clientWith(() =>
        Response.json({ data }, { status: 200 }),
      );
      assertUnknown(await client.restartDeviceOnce(), calls);
    }
  });

  it("treats a bare envelope without success or data as unknown", async () => {
    const { client, calls } = clientWith(() => Response.json({}, { status: 200 }));
    assertUnknown(await client.restartDeviceOnce(), calls);
  });

  it("does not silently accept HTTP 201 with the exact same envelopes", async () => {
    for (const envelope of [{ success: true, data: null }, { data: ASYNC_PHRASE }]) {
      const { client, calls } = clientWith(() =>
        Response.json(envelope, { status: 201 }),
      );
      assertUnknown(await client.restartDeviceOnce(), calls);
    }
  });

  it.each([401, 403, 429, 500])(
    "returns unknown without retrying or reauthenticating after HTTP %i",
    async (status) => {
      const { client, calls } = clientWith(() =>
        Response.json({ detail: "no-echo" }, { status }),
      );
      assertUnknown(await client.restartDeviceOnce(), calls);
    },
  );

  it.each([
    [401, false],
    [403, true],
  ] as const)(
    "retains appropriate session state after HTTP %i without replaying the PUT",
    async (status, expectedSession) => {
      const { client, calls } = clientWith(() => Response.json({}, { status }));
      assertUnknown(await client.restartDeviceOnce(), calls);
      expect(client.hasSession()).toBe(expectedSession);
      // A later explicit request logs in again; the restart PUT itself was sent once.
      await client.login();
      expect(loginCalls(calls)).toHaveLength(2);
      expect(putCalls(calls)).toHaveLength(1);
    },
  );

  it.each(["invalid body", "empty body", "oversized body"])(
    "returns unknown for a %s without retrying",
    async (label) => {
      if (label === "invalid body") {
        const { client, calls } = clientWith(
          () =>
            new Response("{not-json", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        );
        assertUnknown(await client.restartDeviceOnce(), calls);
      } else if (label === "empty body") {
        const { client, calls } = clientWith(() => new Response(null, { status: 200 }));
        assertUnknown(await client.restartDeviceOnce(), calls);
      } else {
        const { client, calls } = clientWith(
          () =>
            new Response("x".repeat(65_537), {
              status: 200,
              headers: {
                "content-type": "application/json",
                "content-length": String(65_537),
              },
            }),
        );
        assertUnknown(await client.restartDeviceOnce(), calls);
      }
    },
  );

  it("returns unknown on a 3xx redirect with manual redirect settings", async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://other.test/" },
        }),
    );
    assertUnknown(await client.restartDeviceOnce(), calls);
    expect(calls.filter((c) => c.url.endsWith("other.test"))).toHaveLength(0);
  });

  it("returns unknown on a network error without retrying", async () => {
    const { client, calls } = clientWith(() => {
      throw new TypeError("fetch failed");
    });
    assertUnknown(await client.restartDeviceOnce(), calls);
  });

  it("returns unknown when the bounded body stalls past the timeout", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<never>(() => undefined),
    });
    const { client, calls } = clientWith(() => new Response(stalled, { status: 200 }));
    assertUnknown(await client.restartDeviceOnce(), calls);
  });

  it("throws a safe login error with zero PUTs when credentials are rejected pre-mutation", async () => {
    const calls: Call[] = [];
    const failingLogin = new ZimaOsClient({
      baseUrl: "http://example.test",
      username: "test",
      password: "synthetic-password",
      fetchImpl: (async (input) => {
        const url = String(input);
        calls.push({ url });
        if (url.endsWith("/v1/users/login")) {
          return Response.json({ success: false, message: "no" }, { status: 200 });
        }
        return Response.json({}, { status: 200 });
      }) as typeof fetch,
    });
    await expect(failingLogin.restartDeviceOnce()).rejects.toMatchObject({
      code: "ZIMAOS_AUTH_FAILED",
    });
    expect(putCalls(calls)).toHaveLength(0);
    expect(loginCalls(calls)).toHaveLength(1);
  });

  it("throws a safe login error with zero PUTs when login times out pre-mutation", async () => {
    const calls: Call[] = [];
    const slowLogin = new ZimaOsClient({
      baseUrl: "http://example.test",
      username: "test",
      password: "synthetic-password",
      timeoutMs: 50,
      fetchImpl: (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        // Honor the abort signal so the client timer actually cuts the request.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 500);
          const onAbort = () => {
            clearTimeout(t);
            reject(new DOMException("Request timed out", "AbortError"));
          };
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          }
        });
        return Response.json({ success: true });
      }) as typeof fetch,
    });
    await expect(slowLogin.restartDeviceOnce()).rejects.toMatchObject({
      code: "ZIMAOS_UNREACHABLE",
    });
    expect(putCalls(calls)).toHaveLength(0);
    expect(loginCalls(calls)).toHaveLength(1);
  });

  it("does not log in again when a session is already cached", async () => {
    const { client, calls } = clientWith(() =>
      Response.json({ success: true, data: ASYNC_PHRASE }, { status: 200 }),
    );
    await client.login();
    expect(loginCalls(calls)).toHaveLength(1);
    expect(await client.restartDeviceOnce()).toEqual({
      status: "accepted",
      accepted: true,
      completion: "unverified",
      retrySafe: false,
    });
    expect(loginCalls(calls)).toHaveLength(1);
    expect(putCalls(calls)).toHaveLength(1);
  });
});
