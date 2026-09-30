import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { AppService } from "../src/zimaos/appService.js";
import { PermissionLayer } from "../src/permissions.js";
import { AppError } from "../src/errors.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

/**
 * Focused tests for the in-process safe-install serialization lock and the
 * process-wide install-name reservation around `AppService.installSafeCompose`
 * (Phase 2C).
 *
 * Contract under test: the FULL preflight + real POST runs under one
 * process-wide queue, so simultaneous same-name installs never race. On top of
 * that, after a ready preflight and before the single real install POST the
 * exact normalized name is reserved process-wide; while it is reserved, any
 * further same-name call fails closed with a fixed AppError ZIMAOS_BAD_REQUEST
 * and ZERO additional real POSTs — even when its own fresh list read is stale
 * (still empty), because an accepted async install may not appear in the app
 * list yet. The reservation is kept for accepted, upstream_error, and
 * timeout/uncertain outcomes; it is released only on a definitive rejected
 * outcome or a known pre-POST failure. Different names are independent: each
 * reserves its own name and still installs normally. No retry anywhere in this
 * path, no re-login to retry, no bypass — every install goes through the same
 * queue. This is local process-wide state only; it does not claim atomicity
 * against actors outside this server process.
 */

const BASE = "http://zimaos.test:8080";
/** Fake routes key on pathname only (query string stripped). */
const COMPOSE_PATH = "/v2/app_management/compose";
/** Full real-install URL the client must call exactly once per accepted install. */
const INSTALL_URL = `${BASE}/v2/app_management/compose?dry_run=false&check_port_conflict=true`;

interface Harness {
  fake: FakeZimaOs;
  service: AppService;
  /** Every full request URL sent by the client, in order. */
  urls: string[];
}

function makeHarness(timeoutMs = 5_000): Harness {
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
    timeoutMs,
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

/**
 * Register the list route as an ordered sequence of static specs (the fake
 * consumes one per call): `before` answers the first read, `after` every
 * later read — modeling either a host state change caused by a real install
 * POST between concurrent requests, or a STALE list that never reflects it.
 */
function listRouteBeforeAfter(
  fake: FakeZimaOs,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  fake.on("GET", COMPOSE_PATH, { json: { success: true, message: "ok", data: before } });
  fake.on("GET", COMPOSE_PATH, { json: { success: true, message: "ok", data: after } });
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

const OTHER_SAFE_SOURCE = [
  "name: other-app",
  "services:",
  "  web:",
  '    image: "nginx:alpine"',
  "",
].join("\n");

const STALE_SOURCE = SAFE_SOURCE.replace("my-app", "stale-app");
const TIMEOUT_SOURCE = SAFE_SOURCE.replace("my-app", "timeout-app");
const SERIAL_SOURCE = SAFE_SOURCE.replace("my-app", "serial-app");
const SERIAL_OTHER_SOURCE = OTHER_SAFE_SOURCE.replace("other-app", "serial-other-app");

function enabledPermissions(): PermissionLayer {
  return new PermissionLayer({ allowAppControl: false, allowAppInstall: true });
}

async function waitFor(
  probe: () => boolean,
  what: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("AppService.installSafeCompose install lock and name reservation (Phase 2C concurrency)", () => {
  it("simultaneous same-name installs: first accepted, second fails closed from its own fresh list — never two real POSTs", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    // The fake host state change: A's fresh read is empty; B's fresh read
    // (after A's install was accepted upstream) already contains my-app.
    listRouteBeforeAfter(h.fake, {}, { "my-app": { name: "my-app" } });
    // Consumed in request order: A's dry run, then A's real install. B must
    // never reach any POST of its own.
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });
    h.fake.on("POST", COMPOSE_PATH, { status: 200, json: { success: true } });

    // The lock serializes in call order: the first request runs its full
    // preflight + POST before the second one starts.
    const [first, second] = await Promise.all([
      h.service.installSafeCompose(SAFE_SOURCE, enabledPermissions()),
      h.service.installSafeCompose(SAFE_SOURCE, enabledPermissions()).then(
        (r) => r as unknown,
        (e: unknown) => e,
      ),
    ]);

    // First request: accepted after exactly one real install attempt.
    expect(first).toEqual({ status: "accepted", accepted: true });

    // Second request: its fresh list read under the lock already reflects
    // the fake host state change, so it fails closed as a duplicate —
    // never reaching any POST of its own.
    expect(second).toBeInstanceOf(AppError);
    expect(second).toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
      message: "An application with this identity already exists on the host.",
    });

    // Never two real POSTs: exactly one install attempt happened in total, and
    // it carried the exact original source.
    expect(installPosts(h)).toHaveLength(1);
    const installCall = h.fake.calls.find(
      (c) => c.method === "POST" && c.path === COMPOSE_PATH && c.body === SAFE_SOURCE,
    );
    expect(installCall?.body).toBe(SAFE_SOURCE);

    // The second request's duplicate verdict came from its own fresh list read
    // under the lock — and that read happened only AFTER A's real install POST
    // was already sent (the fake state change it observes).
    const listUrls = h.urls.filter((u) => u === `${BASE}/v2/app_management/compose`);
    expect(listUrls).toHaveLength(2);
    expect(h.urls.indexOf(INSTALL_URL)).toBeLessThan(
      h.urls.lastIndexOf(`${BASE}/v2/app_management/compose`),
    );

    // No retry of the first install and no dry run for B: exactly one dry run
    // (A's preflight) plus A's single real POST.
    const composePosts = h.fake.calls.filter(
      (c) => c.method === "POST" && c.path === COMPOSE_PATH,
    );
    expect(composePosts).toHaveLength(2);
    expect(h.urls.filter((u) => u.includes("dry_run=true"))).toHaveLength(1);
  });

  it("keeps the reservation after an accepted install: a second same-name call with a STALE empty list fails closed with zero additional real POSTs", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    // Stale host list: EVERY read — including B's fresh read under the lock,
    // after A's install was accepted upstream — is still empty. The duplicate
    // check against the list therefore CANNOT catch this; only the local
    // reservation can.
    listRouteBeforeAfter(h.fake, {}, {});
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });

    const first = await h.service.installSafeCompose(STALE_SOURCE, enabledPermissions());
    expect(first).toEqual({ status: "accepted", accepted: true });
    expect(installPosts(h)).toHaveLength(1);

    // Second call with the same name: its fresh list read is stale (empty), so
    // preflight passes; the reserved exact normalized name must then fail it
    // closed BEFORE any real install POST — fixed AppError ZIMAOS_BAD_REQUEST.
    const second = await h.service
      .installSafeCompose(STALE_SOURCE, enabledPermissions())
      .then(
        (r) => r as unknown,
        (e: unknown) => e,
      );
    expect(second).toBeInstanceOf(AppError);
    expect(second).toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });

    // Zero additional real POSTs: still exactly one in total. The reservation
    // verdict is local — B's second list read happened but no dry run and no
    // install followed it.
    expect(installPosts(h)).toHaveLength(1);
    const listUrls = h.urls.filter((u) => u === `${BASE}/v2/app_management/compose`);
    expect(listUrls).toHaveLength(2);
    expect(h.urls.filter((u) => u.includes("dry_run=true"))).toHaveLength(1);
  });

  it("keeps the reservation after a timed-out attempt: a second same-name call adds zero real POSTs", async () => {
    const fake = new FakeZimaOs();
    loginOk(fake);
    // Stale host list for every read: the duplicate check cannot catch B.
    listRouteBeforeAfter(fake, {}, {});
    // Dry run answers normally; the real install POST hangs until the client's
    // timeout aborts it (uncertain outcome — the attempt may have landed).
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
    const permissions = enabledPermissions();

    // First call: the ambiguous transport failure after the single attempt
    // propagates (never normalized to success) and is never retried.
    await expect(
      service.installSafeCompose(TIMEOUT_SOURCE, permissions),
    ).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
    expect(urls.filter((u) => u === INSTALL_URL)).toHaveLength(1);

    // Second call with the same name: if the lock were still held after the
    // error this would hang forever; it must run a fresh preflight under the
    // released lock. Its list read is stale (empty), so only the reservation —
    // kept for the uncertain timeout outcome — can stop it, and it must fail
    // closed with zero additional real POSTs.
    await expect(
      service.installSafeCompose(TIMEOUT_SOURCE, permissions),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });

    // Still exactly one real install POST in total (the timed-out attempt);
    // the second call added only its fresh list read — no dry run, no POST.
    expect(urls.filter((u) => u === INSTALL_URL)).toHaveLength(1);
    expect(urls.filter((u) => u.includes("dry_run=true"))).toHaveLength(1);
  });

  it("serializes different names conservatively: each reserves its own name and both install with no upstream traffic from the second until the first fully completes", async () => {
    const h = makeHarness(10_000);
    loginOk(h.fake);
    // A's fresh read is empty; B's fresh read (only possible after A's install
    // was accepted) already contains my-app — yet B installs other-app, a
    // different name: its reservation does not collide with A's.
    listRouteBeforeAfter(h.fake, {}, { "serial-app": { name: "serial-app" } });
    // POST specs consumed in order by what reaches the fake: A's dry run, B's
    // dry run, then B's real install (A's real install is intercepted below).
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });
    h.fake.on("POST", COMPOSE_PATH, { status: 200, json: { success: true } });

    // Gate: hold A's real install POST in flight until released. Everything
    // else delegates to the fake (dry runs answer accepted).
    let releaseGate!: () => void;
    const gateHeld = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gated = false;
    const events: string[] = [];
    let gatedInstallBody: string | undefined;
    const gatingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      h.urls.push(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (
        method === "POST" &&
        !url.includes("dry_run=true") &&
        !url.endsWith("/v1/users/login")
      ) {
        if (!gated) {
          gated = true;
          events.push("install-post");
          gatedInstallBody = init?.body === undefined ? undefined : String(init.body);
          await gateHeld; // hold A's real POST in flight
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
      }
      return h.fake.fetchImpl(input, init);
    }) as typeof fetch;

    const client = new ZimaOsClient({
      baseUrl: BASE,
      username: "admin",
      password: "pw",
      fetchImpl: gatingFetch,
      timeoutMs: 10_000,
    });
    const service = new AppService(client);
    const permissions = enabledPermissions();

    // Both requests start at the same time; different names.
    const firstP = service.installSafeCompose(SERIAL_SOURCE, permissions);
    const secondP = service.installSafeCompose(SERIAL_OTHER_SOURCE, permissions);

    // Wait until A's real install POST is in flight (A's full preflight done).
    await waitFor(() => events.includes("install-post"), "first install POST");

    // While the gate holds: B must have performed NO upstream traffic at all —
    // not even its list read. Exactly one list read and exactly one dry run so
    // far, both belonging to A; the single real POST is still in flight.
    expect(
      h.fake.calls.filter((c) => c.method === "GET" && c.path === COMPOSE_PATH),
    ).toHaveLength(1);
    const dryRuns = h.urls.filter((u) => u.includes("dry_run=true"));
    expect(dryRuns).toHaveLength(1);
    expect(h.urls.filter((u) => u === INSTALL_URL)).toHaveLength(1);

    // Release the gate: A completes, then B runs its full preflight + POST.
    releaseGate();
    const [first, second] = await Promise.all([firstP, secondP]);

    expect(first).toEqual({ status: "accepted", accepted: true });
    expect(second).toEqual({ status: "accepted", accepted: true });

    // Conservative serialization end state: one list read and one dry run per
    // request (two each), exactly two real POSTs total — one per name, each
    // carrying its exact original source. B's first traffic is its fresh list
    // read, which only happened after A's install completed; B reserved a
    // different normalized name and was not blocked by A's reservation.
    expect(
      h.fake.calls.filter((c) => c.method === "GET" && c.path === COMPOSE_PATH),
    ).toHaveLength(2);
    expect(h.urls.filter((u) => u.includes("dry_run=true"))).toHaveLength(2);
    expect(installPosts(h)).toHaveLength(2);
    const bodies = h.fake.calls
      .filter((c) => c.method === "POST" && c.path === COMPOSE_PATH)
      .map((c) => c.body);
    expect(bodies.filter((b) => b === SERIAL_SOURCE)).toHaveLength(1); // A's dry run only
    expect(bodies.filter((b) => b === SERIAL_OTHER_SOURCE)).toHaveLength(2); // B's dry run + install
    expect(gatedInstallBody).toBe(SERIAL_SOURCE); // A's in-flight real POST body
  });

  it("releases a name after definitive rejection, allowing a later attempt", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listRouteBeforeAfter(h.fake, {}, {});
    const source = SAFE_SOURCE.replace("my-app", "release-app");
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });
    h.fake.on("POST", COMPOSE_PATH, { json: { success: false } });
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });
    h.fake.on("POST", COMPOSE_PATH, { json: { success: true } });

    expect(await h.service.installSafeCompose(source, enabledPermissions())).toEqual({
      status: "rejected",
      accepted: false,
    });
    expect(await h.service.installSafeCompose(source, enabledPermissions())).toEqual({
      status: "accepted",
      accepted: true,
    });
    expect(installPosts(h)).toHaveLength(2);
  });
});
