import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";

const login = () =>
  new Response(JSON.stringify({ data: { token: { access_token: "test-token" } } }));

describe.each(["resources", "os-update"] as const)(
  "bounded diagnostic transport: %s",
  (kind) => {
    const path =
      kind === "resources" ? "/v1/sys/utilization" : "/v2/installer/release/current";
    const call = (client: ZimaOsClient) =>
      kind === "resources" ? client.getSystemResources() : client.getOsUpdateStatus();
    it.each([
      [
        "redirect",
        () =>
          new Response("", {
            status: 302,
            headers: { location: "http://external.test/secret" },
          }),
      ],
      [
        "declared oversize",
        () => new Response("{}", { headers: { "content-length": "65537" } }),
      ],
      ["streamed oversize", () => new Response("x".repeat(65537))],
      ["invalid UTF-8", () => new Response(new Uint8Array([0xff]))],
      ["non-JSON", () => new Response("password=secret")],
      [
        "explicit failure",
        () => new Response('{"success":false,"message":"password=secret"}'),
      ],
      ["forbidden", () => new Response("secret", { status: 403 })],
      ["rate-limited", () => new Response("secret", { status: 429 })],
      ["unavailable", () => new Response("secret", { status: 503 })],
    ] as const)(
      "rejects %s without reflection/redirect/mutation",
      async (_name, response) => {
        const recorded: { path: string; options?: RequestInit }[] = [];
        const client = new ZimaOsClient({
          baseUrl: "http://zimaos.test",
          username: "test",
          password: "test-password",
          fetchImpl: async (url, options) => {
            const p = new URL(String(url)).pathname;
            recorded.push({ path: p, options });
            return p === "/v1/users/login" ? login() : response();
          },
        });
        await expect(call(client)).rejects.not.toThrow("secret");
        expect(recorded.map((c) => c.path)).toEqual(["/v1/users/login", path]);
        expect(recorded[1]?.options).toMatchObject({
          method: "GET",
          redirect: "manual",
          headers: { Authorization: "Bearer test-token" },
        });
        expect(recorded[1]?.options?.body).toBeUndefined();
      },
    );
    it("bounds slow streamed bodies by the request timeout", async () => {
      const client = new ZimaOsClient({
        baseUrl: "http://zimaos.test",
        username: "test",
        password: "test-password",
        timeoutMs: 20,
        fetchImpl: async (url) =>
          new URL(String(url)).pathname === "/v1/users/login"
            ? login()
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode("{"));
                  },
                }),
              ),
      });
      await expect(call(client)).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
    });
    it("reauthenticates one expired session read, without non-authentication writes", async () => {
      let logins = 0;
      let gets = 0;
      const client = new ZimaOsClient({
        baseUrl: "http://zimaos.test",
        username: "test",
        password: "test-password",
        fetchImpl: async (url, options) => {
          const p = new URL(String(url)).pathname;
          if (p === "/v1/users/login") {
            logins++;
            return login();
          }
          expect(options?.method).toBe("GET");
          gets++;
          return new Response("", { status: 401 });
        },
      });
      await expect(call(client)).rejects.toMatchObject({ code: "ZIMAOS_AUTH_FAILED" });
      expect(logins).toBe(2);
      expect(gets).toBe(2);
    });
  },
);
