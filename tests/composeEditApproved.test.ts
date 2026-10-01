import { describe, expect, it } from "vitest";
import { ChallengeLedger } from "../src/approval/challengeLedger.js";
import { buildEditIntents } from "../src/approval/editIntent.js";
import { sourceFingerprint } from "../src/approval/intent.js";
import {
  parsePendingEditPayload,
  type PendingEditPayload,
} from "../src/approval/requestState.js";
import { PermissionLayer } from "../src/permissions.js";
import { ComposeEditService } from "../src/zimaos/composeEdit.js";
import type { ZimaOsClient } from "../src/zimaos/client.js";

let sequence = 0;
const target = "http://zimaos.test";
const principal = "fixture-principal";
const enabled = new PermissionLayer({ allowAppControl: false, allowAppEdit: true });
const disabled = new PermissionLayer({ allowAppControl: true });
function setup() {
  const id = `p3-approval-${++sequence}`;
  const base = `name: ${id}\nservices:\n  web:\n    image: nginx:alpine\n`;
  const candidate = base + "    privileged: true\n";
  let current = base;
  const calls: string[] = [];
  let attempt = async () => ({ status: "accepted" as const, accepted: true });
  const client = {
    async getComposeAppYaml() {
      calls.push("GET");
      return current;
    },
    async validateComposeChange() {
      calls.push("DRY");
      return { status: "accepted" as const, accepted: true };
    },
    async applyComposeChangeOnce(_id: string, source: string) {
      calls.push("APPLY");
      expect(source).toBe(candidate);
      return attempt();
    },
  } as unknown as ZimaOsClient;
  const service = new ComposeEditService(client);
  const ledger = new ChallengeLedger();
  async function issue(): Promise<PendingEditPayload> {
    const validation = await service.validate(id, sourceFingerprint(base), candidate);
    const intents = buildEditIntents({
      id,
      baseFingerprint: sourceFingerprint(base),
      source: candidate,
      risks: validation.risks,
      target,
    });
    const challenge = ledger.issue({
      tool: "edit_app_compose",
      contentFingerprint: intents.contentSha256,
      principal,
    });
    return {
      version: 1,
      tool: "edit_app_compose",
      challengeId: challenge.id,
      ...intents,
      expiresAtMs: challenge.expiresAtMs,
    };
  }
  const approved = (
    state: PendingEditPayload,
    options: {
      id?: string;
      base?: string;
      candidate?: string;
      permissions?: PermissionLayer;
      target?: string;
      principal?: string;
    } = {},
  ) =>
    service.editApproved(
      options.id ?? id,
      options.base ?? sourceFingerprint(base),
      options.candidate ?? candidate,
      options.permissions ?? enabled,
      state,
      options.target ?? target,
      options.principal ?? principal,
      ledger,
    );
  return {
    id,
    base,
    candidate,
    calls,
    service,
    ledger,
    issue,
    approved,
    setCurrent(next: string) {
      current = next;
    },
    setAttempt(fn: typeof attempt) {
      attempt = fn;
    },
  };
}
const realAttempts = (calls: string[]) => calls.filter((call) => call === "APPLY");

describe("risky existing-app edit continuation (mocked official API)", () => {
  it("first round discloses risk without any apply; approved round consumes before one PUT and rejects replay", async () => {
    const f = setup();
    expect(
      await f.service.edit(f.id, sourceFingerprint(f.base), f.candidate, enabled),
    ).toMatchObject({ status: "confirmation_required" });
    expect(realAttempts(f.calls)).toHaveLength(0);
    const state = await f.issue();
    f.setAttempt(async () => {
      expect(f.ledger.inspect(state.challengeId).state).toBe("consumed");
      return { status: "accepted", accepted: true };
    });
    expect(await f.approved(state)).toMatchObject({
      status: "accepted",
      observation: "pending",
    });
    expect(f.ledger.inspect(state.challengeId).state).toBe("consumed");
    await expect(f.approved(state)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(realAttempts(f.calls)).toHaveLength(1);
  });
  it("rejects exact-content, target, app identity, base, options and risk delta changes before mutation", async () => {
    const f = setup();
    const state = await f.issue();
    for (const trial of [
      () => f.approved(state, { candidate: f.candidate + "# changed\n" }),
      () => f.approved(state, { id: "another-app" }),
      () => f.approved(state, { base: "a".repeat(64) }),
      () => f.approved(state, { target: target + "/other" }),
      () => f.approved({ ...state, optionsDigest: "0".repeat(64) }),
      () => f.approved({ ...state, riskDisclosureDigest: "0".repeat(64) }),
    ]) {
      await expect(trial()).rejects.toMatchObject({ code: "INPUT_INVALID" });
    }
    expect(f.ledger.inspect(state.challengeId).state).toBe("pending");
    expect(realAttempts(f.calls)).toHaveLength(0);
  });
  it("rejects expiry and changed current Compose after approval without consumption", async () => {
    const f = setup();
    const state = await f.issue();
    expect(() => parsePendingEditPayload(state, state.expiresAtMs)).toThrow();
    f.setCurrent(f.base.replace("nginx:alpine", "nginx:stable"));
    await expect(f.approved(state)).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(f.ledger.inspect(state.challengeId).state).toBe("pending");
    expect(realAttempts(f.calls)).toHaveLength(0);
  });
  it("rechecks permission after approval and does not burn the challenge", async () => {
    const f = setup();
    const state = await f.issue();
    await expect(f.approved(state, { permissions: disabled })).rejects.toMatchObject({
      code: "APP_EDIT_DISABLED",
    });
    expect(f.ledger.inspect(state.challengeId).state).toBe("pending");
    expect(realAttempts(f.calls)).toHaveLength(0);
  });
  it("consumes an ambiguous attempt and does not issue another PUT", async () => {
    const f = setup();
    const state = await f.issue();
    f.setAttempt(async () => {
      throw new Error("timeout");
    });
    expect(await f.approved(state)).toMatchObject({
      status: "upstream_error",
      observation: "pending",
    });
    expect(f.ledger.inspect(state.challengeId).state).toBe("consumed");
    await expect(f.approved(state)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(realAttempts(f.calls)).toHaveLength(1);
  });
});
