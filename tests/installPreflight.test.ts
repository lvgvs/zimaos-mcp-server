import { describe, expect, it } from "vitest";

import { ZimaOsClient } from "../src/zimaos/client.js";
import { AppService } from "../src/zimaos/appService.js";
import { PermissionLayer } from "../src/permissions.js";
import { preflightInstall } from "../src/zimaos/installPreflight.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

/**
 * Focused tests for the non-mutating install preflight
 * (`src/zimaos/installPreflight.ts`).
 *
 * Preflight composes: PermissionLayer.assertCanInstall -> parseCompose (exact
 * name) -> AppService.listApps (one read) + assertInstallIdentity ->
 * AppService.validateCompose (one dry run). It never installs. Fail-closed
 * rules under test: permission default-off with zero upstream traffic, unnamed
 * documents, duplicate identities, rejected/ambiguous dry runs (502 is NOT
 * invalid input), and nonempty host port conflicts. The exact original source
 * reaches the dry run exactly once; listApps is read at most once per call.
 */

const BASE = "http://zimaos.test:8080";
/** Fake routes key on pathname only (query string stripped). */
const LIST_PATH = "/v2/app_management/compose";
const DRY_RUN_PATH = "/v2/app_management/compose";
/** Full dry-run URL the client must call (query string included). */
const DRY_RUN_URL = `${BASE}/v2/app_management/compose?dry_run=true&check_port_conflict=true`;

interface RequestRecord {
  method: string;
  url: string;
}

interface Harness {
  fake: FakeZimaOs;
  service: AppService;
  /** Every request (method + full URL) sent by the client, in order. */
  requests: RequestRecord[];
}

function makeHarness(): Harness {
  const fake = new FakeZimaOs();
  const requests: RequestRecord[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input) });
    return fake.fetchImpl(input, init);
  }) as typeof fetch;
  const client = new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl,
    timeoutMs: 5_000,
  });
  return { fake, service: new AppService(client), requests };
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
  fake.ok("GET", LIST_PATH, data);
}

function dryRunOk(fake: FakeZimaOs): void {
  fake.on("POST", DRY_RUN_PATH, { json: { success: true } });
}

function listCalls(fake: FakeZimaOs) {
  return fake.calls.filter((c) => c.method === "GET" && c.path === LIST_PATH);
}

function dryRunCalls(fake: FakeZimaOs) {
  return fake.calls.filter((c) => c.method === "POST" && c.path === DRY_RUN_PATH);
}

/**
 * Assert nothing was installed: every POST to the compose endpoint must be the
 * documented dry-run URL (an install would POST the same path without the
 * dry_run query string).
 */
function expectNoInstall(h: Harness): void {
  const postCompose = h.requests
    .filter((r) => r.method === "POST" && r.url.startsWith(`${BASE}${LIST_PATH}`))
    .map((r) => r.url);
  expect(postCompose).toEqual([DRY_RUN_URL]);
}

const SAFE_SOURCE = [
  "name: my-app",
  "services:",
  "  web:",
  "    image: nginx:alpine",
  "",
].join("\n");

const RISKY_SOURCE = [
  "name: risky-app",
  "services:",
  "  web:",
  "    image: nginx",
  "    privileged: true",
  "",
].join("\n");

describe("preflightInstall (non-mutating, mocked HTTP)", () => {
  it("fails closed with zero upstream traffic when install permission is default-off", async () => {
    const h = makeHarness();
    // No routes registered at all: any upstream call would throw.
    const permissions = new PermissionLayer({ allowAppControl: false });

    await expect(
      preflightInstall(SAFE_SOURCE, h.service, permissions),
    ).rejects.toMatchObject({
      code: "APP_INSTALL_DISABLED",
    });

    // Zero upstream traffic: no login, no list read, no dry run.
    expect(h.fake.calls).toHaveLength(0);
  });

  it("fails closed for an unnamed document without echoing source content", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });
    // No top-level name key at all.
    const source = "services:\n  web:\n    image: nginx\n";

    await expect(preflightInstall(source, h.service, permissions)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: "A top-level compose name is required for install.",
    });

    // Identity failed before validation: no dry run; exactly one list read.
    expect(dryRunCalls(h.fake)).toHaveLength(0);
    expect(listCalls(h.fake)).toHaveLength(1);
  });

  it("fails closed when the name duplicates an existing app id", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, [{ id: "my-app" }]);
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    await expect(
      preflightInstall(SAFE_SOURCE, h.service, permissions),
    ).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
      message: "An application with this identity already exists on the host.",
    });

    // Duplicate detected from the single list read; no dry run, no install.
    expect(listCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)).toHaveLength(0);
  });

  it("returns ready for a safe named document with the exact parsed name", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, [{ id: "other-app" }]);
    dryRunOk(h.fake);
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    const result = await preflightInstall(SAFE_SOURCE, h.service, permissions);

    expect(result).toEqual({ status: "ready", name: "my-app", findings: [] });
    // The exact original source reaches the dry run exactly once.
    expect(dryRunCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)[0]?.body).toBe(SAFE_SOURCE);
    expect(
      h.requests.filter((r) => r.method === "POST" && r.url === DRY_RUN_URL),
    ).toHaveLength(1);
    // One list read, one dry run; nothing installed.
    expect(listCalls(h.fake)).toHaveLength(1);
    expectNoInstall(h);
  });

  it("returns confirmation_required for a risky named document without installing", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    dryRunOk(h.fake);
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    const result = await preflightInstall(RISKY_SOURCE, h.service, permissions);

    expect(result.status).toBe("confirmation_required");
    // Exact name from parseCompose.
    expect(result.name).toBe("risky-app");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.category)).toEqual(["privileged"]);
    // The dry run ran once with the exact source; no install request at all.
    expect(dryRunCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)[0]?.body).toBe(RISKY_SOURCE);
    expectNoInstall(h);
  });

  it("fails closed on a rejected dry run without classifying the document invalid", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    h.fake.on("POST", DRY_RUN_PATH, {
      status: 400,
      json: { success: false, message: "SECRET-UPSTREAM-TEXT" },
    });
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    await expect(
      preflightInstall(SAFE_SOURCE, h.service, permissions),
    ).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
      message:
        "The ZimaOS host rejected this compose document during dry-run validation.",
    });

    // Exactly one list read and one dry run; no install.
    expect(listCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)).toHaveLength(1);
  });

  it("fails closed on an ambiguous upstream_error (502) without classifying it invalid", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    h.fake.on("POST", DRY_RUN_PATH, { status: 502, text: "SECRET-UPSTREAM-TEXT" });
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    await expect(
      preflightInstall(SAFE_SOURCE, h.service, permissions),
    ).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
      message:
        "Compose dry-run validation could not be completed; install preflight failed safely.",
    });

    // A 502 is ambiguous, NOT invalid input.
    expect(listCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)).toHaveLength(1);
  });

  it("fails closed when the dry run reports nonempty host port conflicts", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    h.fake.on("POST", DRY_RUN_PATH, {
      status: 400,
      json: { success: false, data: { ports_in_use: [8080] } },
    });
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });

    await expect(
      preflightInstall(SAFE_SOURCE, h.service, permissions),
    ).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
      message:
        "One or more host ports required by this compose document are already in use on the ZimaOS host.",
    });

    expect(listCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)).toHaveLength(1);
  });

  it("never echoes raw YAML: parse failure yields a fixed normalized AppError", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    listOk(h.fake, []);
    const permissions = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });
    // Malformed YAML that would be embarrassing to echo back.
    const source = "name: my-app\nservices:\n  web: [unclosed\n";

    await expect(preflightInstall(source, h.service, permissions)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: "The compose document could not be parsed for install preflight.",
    });

    // Local parse failure short-circuits before any upstream traffic.
    expect(h.fake.calls).toHaveLength(0);
  });
});
