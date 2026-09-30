import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { AppService } from "../src/zimaos/appService.js";
import { PermissionLayer } from "../src/permissions.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

/**
 * Focused tests for the safe installation service `AppService.installSafeCompose`
 * (Phase 2C, no approval logic).
 *
 * Contract under test: preflightInstall runs first; a disabled permission or a
 * duplicate identity fails closed with zero install traffic; a
 * confirmation_required preflight result is returned WITHOUT any mutation; a
 * ready result performs exactly ONE real install POST (dry_run=false) carrying
 * the exact original source, never retried — including after an ambiguous
 * timeout. Outcomes are fixed-shape asynchronous acceptance data, not claimed
 * completion: 2xx success:false -> rejected, ambiguous failure -> upstream
 * error / propagated transport AppError.
 */

const BASE = "http://zimaos.test:8080";
/** Fake routes key on pathname only (query string stripped). */
const COMPOSE_PATH = "/v2/app_management/compose";
/** Full real-install URL the client must call exactly once (no dry_run=true). */
const INSTALL_URL = `${BASE}/v2/app_management/compose?dry_run=false&check_port_conflict=true`;

interface Harness {
  fake: FakeZimaOs;
  service: AppService;
  /** Every full request URL sent by the client, in order. */
  urls: string[];
}

function makeHarness(): Harness {
  const fake = new FakeZimaOs();
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
  return { fake, service: new AppService(client), urls };
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

function listOk(fake: FakeZimaOs, apps: Array<{ id: string; name?: string }>): void {
  const data: Record<string, unknown> = {};
  for (const app of apps) {
    data[app.id] = { name: app.name ?? app.id };
  }
  fake.ok("GET", COMPOSE_PATH, data);
}

/**
 * Register the two POST responses consumed in order on the compose pathname:
 * first the dry run (preflight), then the real install. The fake consumes one
 * spec per call for a key, so order matches request order.
 */
function dryRunThenInstall(
  fake: FakeZimaOs,
  installSpec: { status?: number; json?: unknown },
): void {
  fake.on("POST", COMPOSE_PATH, { json: { success: true } }); // dry run (preflight)
  fake.on("POST", COMPOSE_PATH, installSpec); // real install attempt
}

function installPosts(h: Harness): string[] {
  return h.urls.filter((u) => u === INSTALL_URL);
}

const SAFE_SOURCE = [
  "name: my-app",
  "services:",
  "  web:",
  '    image: "nginx:alpine"',
  "",
].join("\n");

const REJECTED_SOURCE = SAFE_SOURCE.replace("my-app", "rejected-app");
const TIMEOUT_SOURCE = SAFE_SOURCE.replace("my-app", "safe-timeout-app");

const RISKY_SOURCE = [
  "name: risky-app",
  "services:",
  "  web:",
  "    image: nginx",
  "    privileged: true",
  "",
].join("\n");

function enabledPermissions(): PermissionLayer {
  return new PermissionLayer({ allowAppControl: false, allowAppInstall: true });
}

describe("AppService.installSafeCompose (Phase 2C safe install, mocked HTTP)", () => {
  it("fails closed with zero upstream traffic when install permission is default-off", async () => {
    const h = makeHarness();
    // No routes registered at all: any upstream call would throw.
    const permissions = new PermissionLayer({ allowAppControl: false });

    await expect(
      h.service.installSafeCompose(SAFE_SOURCE, permissions),
    ).rejects.toMatchObject({
      code: "APP_INSTALL_DISABLED",
    });

    // Zero upstream traffic: no login, no list read, no dry run, no install.
    expect(h.fake.calls).toHaveLength(0);
    expect(installPosts(h)).toHaveLength(0);
  });

  it("fails closed on a duplicate identity without any install POST", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, [{ id: "my-app" }]);

    await expect(
      h.service.installSafeCompose(SAFE_SOURCE, enabledPermissions()),
    ).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
      message: "An application with this identity already exists on the host.",
    });

    // Duplicate detected from the single list read; no dry run and no install.
    expect(
      h.fake.calls.filter((c) => c.method === "GET" && c.path === COMPOSE_PATH),
    ).toHaveLength(1);
    expect(installPosts(h)).toHaveLength(0);
  });

  it("installs a safe document with exactly one real POST and returns asynchronous acceptance", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, [{ id: "other-app" }]);
    dryRunThenInstall(h.fake, { status: 200, json: { success: true } });

    const result = await h.service.installSafeCompose(SAFE_SOURCE, enabledPermissions());

    // Fixed-shape asynchronous acceptance outcome — not claimed completion.
    expect(result).toEqual({ status: "accepted", accepted: true });

    // Exactly one real install POST at the documented URL...
    expect(installPosts(h)).toHaveLength(1);
    const installCall = h.fake.calls.find(
      (c) => c.method === "POST" && c.path === COMPOSE_PATH && c.body === SAFE_SOURCE,
    );
    // ...carrying the exact original source unchanged as YAML.
    expect(installCall?.body).toBe(SAFE_SOURCE);
    expect(h.fake.calls.filter((c) => c.body === SAFE_SOURCE)).toHaveLength(2); // dry run + install only
    const postBodies = h.fake.calls
      .filter((c) => c.method === "POST" && c.path === COMPOSE_PATH)
      .map((c) => c.headers["content-type"]);
    expect(postBodies).toEqual(["application/yaml", "application/yaml"]);

    // No unconditional second mutation: one dry run, one install, no re-login.
    const composePosts = h.fake.calls.filter(
      (c) => c.method === "POST" && c.path === COMPOSE_PATH,
    );
    expect(composePosts).toHaveLength(2);
    expect(h.urls.filter((u) => u.includes("dry_run=true"))).toHaveLength(1);
    expect(h.fake.calls.filter((c) => c.path === "/v1/users/login")).toHaveLength(1);
  });

  it("returns confirmation_required for a risky document without any install POST", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    // Only the dry-run route is registered; an install attempt would throw.
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });

    const result = await h.service.installSafeCompose(RISKY_SOURCE, enabledPermissions());

    expect(result.status).toBe("confirmation_required");
    if (result.status === "confirmation_required") {
      expect(result.name).toBe("risky-app");
      expect(result.findings.map((f) => f.category)).toEqual(["privileged"]);
    }
    // No mutation on the confirmation path: exactly one dry run, zero installs.
    const composePosts = h.fake.calls.filter(
      (c) => c.method === "POST" && c.path === COMPOSE_PATH,
    );
    expect(composePosts).toHaveLength(1);
    expect(composePosts[0]?.body).toBe(RISKY_SOURCE);
    expect(installPosts(h)).toHaveLength(0);
  });

  it("returns rejected for a 2xx envelope reporting success:false after exactly one POST", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    dryRunThenInstall(h.fake, { status: 200, json: { success: false } });

    const result = await h.service.installSafeCompose(
      REJECTED_SOURCE,
      enabledPermissions(),
    );

    expect(result).toEqual({ status: "rejected", accepted: false });
    // The single attempt was made exactly once; no retry.
    expect(installPosts(h)).toHaveLength(1);
  });

  it("never retries after an ambiguous timeout: one POST then the transport AppError propagates", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    listOk(fake, []);
    // Dry run answers normally; the install POST hangs until the client aborts.
    fake.on("POST", COMPOSE_PATH, { json: { success: true } });

    const urls: string[] = [];
    const hangingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const method = (init?.method ?? "GET").toUpperCase();
      // Everything except the real install POST answers normally.
      if (
        method === "GET" ||
        url.endsWith("/v1/users/login") ||
        url.includes("dry_run=true")
      ) {
        return fake.fetchImpl(input, init);
      }
      // Real install POST: hang until the client's timeout aborts it.
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
    const service = new AppService(client);

    // The ambiguous outcome is a transport failure after the attempt was made;
    // it propagates (never normalized to success) and is never retried.
    await expect(
      service.installSafeCompose(TIMEOUT_SOURCE, enabledPermissions()),
    ).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });

    // Exactly one real install POST — a retry after an ambiguous timeout could
    // create a duplicate app (the install POST is not idempotent).
    expect(urls.filter((u) => u === INSTALL_URL)).toHaveLength(1);
  });
});
