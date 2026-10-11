import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ZimaOsClient } from "../src/zimaos/client.js";

const TOKEN = "synthetic-access-token";
function client() {
  const calls: string[] = [];
  const api = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "admin",
    password: "synthetic-password",
    fetchImpl: (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json({ success: true, data: { token: { access_token: TOKEN } } });
    }) as typeof fetch,
  });
  return { api, calls };
}
const item = {
  repo_id: "community",
  app_id: "com.example.app",
  architectures: ["amd64", "arm64"],
};

describe("projected catalog credential exclusion", () => {
  it("rejects UTF-8 percent-encoded configured credentials without traffic", () => {
    const password = "synthetic-ü-password";
    let calls = 0;
    const api = new ZimaOsClient({
      baseUrl: "http://zimaos.test",
      username: "admin",
      password,
      fetchImpl: (async () => {
        calls += 1;
        throw Error("No I/O expected");
      }) as typeof fetch,
    });
    for (const text of [
      encodeURIComponent(password),
      `%FF${encodeURIComponent(password)}`,
    ]) {
      expect(() => api.assertStoreDiscoverySafe({ ...item, name: text })).toThrow(
        AppError,
      );
    }
    expect(calls).toBe(0);
  });
  it("permits public normalized metadata without any traffic", () => {
    const { api, calls } = client();
    expect(() =>
      api.assertStoreDiscoverySafe({ ...item, name: "Public App" }),
    ).not.toThrow();
    expect(calls).toHaveLength(0);
  });
  it.each([
    "synthetic-password",
    "synthetic-%70assword",
    "password=hunter2",
    "token: hidden",
    "https://alice:secret@example.test/path",
    "https://example.test/?api_key=hidden",
  ])("rejects credential-bearing projected text without reflection: %s", (text) => {
    const { api, calls } = client();
    let err: unknown;
    try {
      api.assertStoreDiscoverySafe({ ...item, tagline: text });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("ZIMAOS_UPSTREAM_ERROR");
    expect((err as AppError).message).not.toContain(text);
    expect(calls).toHaveLength(0);
  });
  it("rejects the current session token without an additional request", async () => {
    const { api, calls } = client();
    await api.getStoreRepositories();
    expect(() => api.assertStoreDiscoverySafe({ ...item, name: TOKEN })).toThrow(
      AppError,
    );
    expect(calls).toEqual([
      "http://zimaos.test/v1/users/login",
      "http://zimaos.test/v3/app_store/repo",
    ]);
  });
});
