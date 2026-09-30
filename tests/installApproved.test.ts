import { describe, expect, it } from "vitest";
import { ChallengeLedger } from "../src/approval/challengeLedger.js";
import { buildPendingInstallIntents } from "../src/approval/intent.js";
import type { PendingInstallPayload } from "../src/approval/requestState.js";
import { analyzeCompose } from "../src/compose/analyze.js";
import { parseCompose } from "../src/compose/parse.js";
import { PermissionLayer } from "../src/permissions.js";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const PATH = "/v2/app_management/compose";
const TARGET = "http://zimaos.test:8080";
const PRINCIPAL = "deployment";
const allowed = new PermissionLayer({ allowAppControl: false, allowAppInstall: true });
const denied = new PermissionLayer({ allowAppControl: false });

function sourceFor(name: string): string {
  return `name: ${name}\nservices:\n  web:\n    image: nginx:alpine\n    privileged: true\n`;
}

function harness(apps: Record<string, unknown> = {}) {
  const fake = new FakeZimaOs();
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return fake.fetchImpl(input, init);
  }) as typeof fetch;
  const client = new ZimaOsClient({
    baseUrl: TARGET,
    username: "admin",
    password: "fixture-only",
    fetchImpl,
    timeoutMs: 500,
  });
  fake.on("POST", "/v1/users/login", {
    json: { success: true, data: { token: { access_token: "fixture-token" } } },
  });
  fake.ok("GET", PATH, apps); // stale unless a test supplies a duplicate
  return { service: new AppService(client), fake, urls };
}

function approval(source: string, ledger = new ChallengeLedger()) {
  const name = parseCompose(source).name!;
  const findings = analyzeCompose(parseCompose(source));
  const intents = buildPendingInstallIntents({ source, name, findings, target: TARGET });
  const issued = ledger.issue({
    tool: "install_app_from_compose",
    contentFingerprint: intents.contentSha256,
    principal: PRINCIPAL,
  });
  const state: PendingInstallPayload = {
    version: 1,
    challengeId: issued.id,
    tool: "install_app_from_compose",
    ...intents,
    expiresAtMs: issued.expiresAtMs,
  };
  return { ledger, state };
}

function realPosts(urls: string[]): string[] {
  return urls.filter((url) => url.includes("dry_run=false&check_port_conflict=true"));
}

describe("approved risky install service continuation", () => {
  it("rechecks risk and dry run under the lock, consumes before one exact-source POST, and rejects replay", async () => {
    const source = sourceFor("approved-service-a");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    fake.on("POST", PATH, { json: { success: true } }); // dry run
    fake.on("POST", PATH, { json: { success: true } }); // real install

    await expect(
      service.installApprovedCompose(source, allowed, state, TARGET, PRINCIPAL, ledger),
    ).resolves.toEqual({ status: "accepted", accepted: true });
    expect(ledger.inspect(state.challengeId).state).toBe("consumed");
    expect(realPosts(urls)).toHaveLength(1);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === PATH)).toHaveLength(
      2,
    );
    expect(
      fake.calls
        .filter((c) => c.method === "POST" && c.path === PATH)
        .every((c) => c.body === source),
    ).toBe(true);
    await expect(
      service.installApprovedCompose(source, allowed, state, TARGET, PRINCIPAL, ledger),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(realPosts(urls)).toHaveLength(1);
  });

  it("denies before upstream and preserves pending state for disabled permission", async () => {
    const source = sourceFor("approved-service-b");
    const { service, fake } = harness();
    const { ledger, state } = approval(source);
    await expect(
      service.installApprovedCompose(source, denied, state, TARGET, PRINCIPAL, ledger),
    ).rejects.toMatchObject({ code: "APP_INSTALL_DISABLED" });
    expect(fake.calls).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");
  });

  it("rejects changed exact source and target without consuming or mutating", async () => {
    const source = sourceFor("approved-service-c");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    await expect(
      service.installApprovedCompose(
        source + "# changed\n",
        allowed,
        state,
        TARGET,
        PRINCIPAL,
        ledger,
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(fake.calls).toHaveLength(0);
    fake.on("POST", PATH, { json: { success: true } });
    await expect(
      service.installApprovedCompose(
        source,
        allowed,
        state,
        TARGET + "/other",
        PRINCIPAL,
        ledger,
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(realPosts(urls)).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");
  });

  it("rejects a new host duplicate before dry run, consumption or install", async () => {
    const source = sourceFor("approved-service-d");
    const { service, urls } = harness({
      "approved-service-d": { name: "approved-service-d" },
    });
    const { ledger, state } = approval(source);
    await expect(
      service.installApprovedCompose(source, allowed, state, TARGET, PRINCIPAL, ledger),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(realPosts(urls)).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");
  });

  it("definitive rejection releases the reservation, but consumes the approval", async () => {
    const source = sourceFor("approved-service-e");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    fake.on("POST", PATH, { json: { success: true } });
    fake.on("POST", PATH, { json: { success: false } });
    fake.on("POST", PATH, { json: { success: true } });
    fake.on("POST", PATH, { json: { success: true } });
    expect(
      await service.installApprovedCompose(
        source,
        allowed,
        state,
        TARGET,
        PRINCIPAL,
        ledger,
      ),
    ).toEqual({ status: "rejected", accepted: false });
    expect(ledger.inspect(state.challengeId).state).toBe("consumed");
    const fresh = approval(source, ledger);
    expect(
      await service.installApprovedCompose(
        source,
        allowed,
        fresh.state,
        TARGET,
        PRINCIPAL,
        ledger,
      ),
    ).toEqual({ status: "accepted", accepted: true });
    expect(realPosts(urls)).toHaveLength(2);
  });

  it("fails closed on changed risk disclosure and on a port conflict, without consuming", async () => {
    const source = sourceFor("approved-service-f");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    fake.on("POST", PATH, {
      status: 400,
      json: { success: false, data: { ports_in_use: [8080] } },
    });
    await expect(
      service.installApprovedCompose(source, allowed, state, TARGET, PRINCIPAL, ledger),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(realPosts(urls)).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");

    fake.on("POST", PATH, { json: { success: true } });
    const changed = { ...state, riskDisclosureDigest: "0".repeat(64) };
    await expect(
      service.installApprovedCompose(source, allowed, changed, TARGET, PRINCIPAL, ledger),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(realPosts(urls)).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");
  });

  it("rejects a wrong principal before mutation without burning the challenge", async () => {
    const source = sourceFor("approved-service-g");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    fake.on("POST", PATH, { json: { success: true } });
    await expect(
      service.installApprovedCompose(source, allowed, state, TARGET, "other", ledger),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(realPosts(urls)).toHaveLength(0);
    expect(ledger.inspect(state.challengeId).state).toBe("pending");
  });

  it("retains the name reservation and consumes approval after an ambiguous post-attempt result", async () => {
    const source = sourceFor("approved-service-h");
    const { service, fake, urls } = harness();
    const { ledger, state } = approval(source);
    fake.on("POST", PATH, { json: { success: true } });
    fake.on("POST", PATH, { status: 502 });
    expect(
      await service.installApprovedCompose(
        source,
        allowed,
        state,
        TARGET,
        PRINCIPAL,
        ledger,
      ),
    ).toEqual({ status: "upstream_error", accepted: false });
    expect(ledger.inspect(state.challengeId).state).toBe("consumed");
    const fresh = approval(source, ledger);
    await expect(
      service.installApprovedCompose(
        source,
        allowed,
        fresh.state,
        TARGET,
        PRINCIPAL,
        ledger,
      ),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(realPosts(urls)).toHaveLength(1);
  });
});
