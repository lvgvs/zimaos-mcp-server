import { describe, expect, it } from "vitest";
import { ComposeEditService } from "../src/zimaos/composeEdit.js";
import { sourceFingerprint } from "../src/approval/intent.js";
import { PermissionLayer } from "../src/permissions.js";
import type { ZimaOsClient } from "../src/zimaos/client.js";

let sequence = 0;
const yaml = (id: string, image = "nginx:alpine", risk = "") =>
  `name: ${id}\nservices:\n  web:\n    image: ${image}\n${risk}`;
const enabled = new PermissionLayer({ allowAppControl: false, allowAppEdit: true });
const disabled = new PermissionLayer({ allowAppControl: true, allowAppInstall: true });
function fixture() {
  const id = `repair-test-${++sequence}`;
  const current = new Map([[id, yaml(id)]]);
  const calls: string[] = [];
  let apply = async (target: string, source: string) => {
    current.set(target, source);
    return { status: "accepted" as const, accepted: true };
  };
  const client = {
    async getComposeAppYaml(target: string) {
      calls.push(`GET:${target}`);
      const result = current.get(target);
      if (!result) throw new Error("not found");
      return result;
    },
    async validateComposeChange(target: string) {
      calls.push(`DRY:${target}`);
      return { status: "accepted" as const, accepted: true };
    },
    async applyComposeChangeOnce(target: string, source: string) {
      calls.push(`APPLY:${target}`);
      return apply(target, source);
    },
  } as unknown as ZimaOsClient;
  return {
    id,
    current,
    calls,
    service: new ComposeEditService(client),
    setApply(fn: typeof apply) {
      apply = fn;
    },
  };
}

describe("safe existing-app edit (mocked official API)", () => {
  it("is independently disabled before any upstream traffic", async () => {
    const f = fixture();
    await expect(
      f.service.edit(f.id, sourceFingerprint(yaml(f.id)), yaml(f.id), disabled),
    ).rejects.toMatchObject({ code: "APP_EDIT_DISABLED" });
    expect(f.calls).toEqual([]);
  });
  it("checks exact base, dry-runs, sends one exact PUT and observes read-only", async () => {
    const f = fixture();
    const next = yaml(f.id, "nginx:stable") + "# preserve exact comment\n";
    const seen: string[] = [];
    f.setApply(async (target, source) => {
      seen.push(source);
      f.current.set(target, source);
      return { status: "accepted", accepted: true };
    });
    expect(
      await f.service.edit(f.id, sourceFingerprint(yaml(f.id)), next, enabled),
    ).toMatchObject({ status: "accepted", observation: "changed" });
    expect(seen).toEqual([next]);
    expect(f.calls.filter((call) => call.startsWith("APPLY:"))).toHaveLength(1);
  });
  it("rejects stale base and a changed external state between preflight and lock", async () => {
    const f = fixture();
    const base = sourceFingerprint(yaml(f.id));
    await expect(
      f.service.edit(f.id, "a".repeat(64), yaml(f.id, "nginx:stable"), enabled),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    const original = f.service.read.bind(f.service);
    let reads = 0;
    f.service.read = async (id) => {
      const result = await original(id);
      if (++reads === 1) f.current.set(id, yaml(id, "nginx:external"));
      return result;
    };
    await expect(
      f.service.edit(f.id, base, yaml(f.id, "nginx:stable"), enabled),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(f.calls.filter((call) => call.startsWith("APPLY:"))).toHaveLength(0);
  });
  it("never mutates a new risky delta", async () => {
    const f = fixture();
    const result = await f.service.edit(
      f.id,
      sourceFingerprint(yaml(f.id)),
      yaml(f.id, "nginx:alpine", "    privileged: true\n"),
      enabled,
    );
    expect(result).toMatchObject({ status: "confirmation_required" });
    expect(f.calls.filter((call) => call.startsWith("APPLY:"))).toHaveLength(0);
  });
  it("serializes overlapping same-app writes and does not repeat an ambiguous mutation", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.setApply(async () => {
      entered();
      await gate;
      throw new Error("ambiguous transport timeout");
    });
    const base = sourceFingerprint(yaml(f.id));
    const next = yaml(f.id, "nginx:stable");
    const first = f.service.edit(f.id, base, next, enabled);
    await called;
    const second = f.service.edit(f.id, base, next, enabled);
    release();
    expect(await first).toMatchObject({
      status: "upstream_error",
      observation: "pending",
    });
    await expect(second).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(f.calls.filter((call) => call.startsWith("APPLY:"))).toHaveLength(1);
  });
  it("allows unrelated app edits to proceed while another app is blocked", async () => {
    const f = fixture();
    const other = `repair-other-${++sequence}`;
    f.current.set(other, yaml(other));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.setApply(async (target, source) => {
      if (target === f.id) {
        entered();
        await gate;
      }
      f.current.set(target, source);
      return { status: "accepted", accepted: true };
    });
    const first = f.service.edit(
      f.id,
      sourceFingerprint(yaml(f.id)),
      yaml(f.id, "nginx:stable"),
      enabled,
    );
    await called;
    expect(
      await f.service.edit(
        other,
        sourceFingerprint(yaml(other)),
        yaml(other, "nginx:stable"),
        enabled,
      ),
    ).toMatchObject({ status: "accepted" });
    release();
    expect(await first).toMatchObject({ status: "accepted" });
  });
});
