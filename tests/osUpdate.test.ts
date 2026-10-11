import { describe, expect, it } from "vitest";
import { normalizeOsUpdateStatus } from "../src/zimaos/osUpdate.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const evidence = () => ({
  current: { data: { version: "1.7.1", release_note: "password=do-not-return" } },
  latest: { data: { version: "1.7.1" } },
  notice: { data: "no-update" },
  status: { data: { status: "idle" }, message: "token=do-not-return" },
  beta: { data: { status: "disabled" } },
});

describe("OS-update read projection", () => {
  it.each(["no-update", "normal-update", "important-update", "force-update"])(
    "uses notice %s even with identical versions",
    (notice) => {
      const raw = evidence();
      raw.notice.data = notice;
      expect(normalizeOsUpdateStatus(raw)).toEqual({
        currentVersion: "1.7.1",
        latestVersion: "1.7.1",
        notice,
        updateAvailable: notice !== "no-update",
        installerStatus: "idle",
        betaSubscription: "disabled",
      });
    },
  );
  it.each(["idle", "installing", "installError"])(
    "preserves installer state %s without completion/progress claims",
    (status) => {
      const raw = evidence();
      raw.status.data.status = status;
      expect(normalizeOsUpdateStatus(raw).installerStatus).toBe(status);
      expect(JSON.stringify(normalizeOsUpdateStatus(raw))).not.toMatch(
        /progress|message|release_note|password|token|complete/,
      );
    },
  );
  it.each([
    null,
    {},
    { ...evidence(), notice: { data: "unknown-token" } },
    { ...evidence(), notice: { success: false, data: "no-update" } },
    { ...evidence(), status: { data: { status: "restarting" } } },
    { ...evidence(), beta: { data: { status: "unknown" } } },
    { ...evidence(), current: { success: 500, data: { version: "1.7.1" } } },
    { ...evidence(), latest: { data: { version: "password=secret" } } },
    { ...evidence(), latest: { data: { version: "1.7.1\nsecret" } } },
    { ...evidence(), latest: { data: { version: "1.7.1-" + "a".repeat(64) } } },
    { ...evidence(), current: { data: {} } },
  ])("fails closed on malformed/unrecognized evidence %j", (raw) => {
    expect(() => normalizeOsUpdateStatus(raw)).toThrow(
      "The OS update response is malformed.",
    );
  });
  it("preserves enabled beta subscription without claiming channel eligibility", () => {
    const raw = evidence();
    raw.beta.data.status = "enabled";
    expect(normalizeOsUpdateStatus(raw).betaSubscription).toBe("enabled");
  });
  it("does not leak a configured credential even when formatted as a version", async () => {
    const raw = evidence();
    const fake = new FakeZimaOs().ok("POST", "/v1/users/login", {
      token: { access_token: "test-token" },
    });
    for (const [path, body] of [
      ["/release/current", raw.current],
      ["/release/latest", raw.latest],
      ["/web/notice", raw.notice],
      ["/status", raw.status],
      ["/beta-subscription", raw.beta],
    ] as const)
      fake.raw("GET", `/v2/installer${path}`, body);
    const client = new ZimaOsClient({
      baseUrl: "http://zimaos.test",
      username: "test",
      password: "1.7.1",
      fetchImpl: fake.fetchImpl,
    });
    await expect(client.getOsUpdateStatus()).rejects.toThrow(
      "The OS update response could not be returned safely.",
    );
  });
});
