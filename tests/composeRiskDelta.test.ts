import { describe, expect, it } from "vitest";
import { compareComposeRisk } from "../src/compose/riskDelta.js";
import { parseCompose } from "../src/compose/parse.js";

const compare = (oldSource: string, newSource: string) =>
  compareComposeRisk(parseCompose(oldSource), parseCompose(newSource));
const base = (fields: string) =>
  `name: repair\nservices:\n  web:\n    image: nginx:alpine\n${fields}`;

describe("existing-app Compose risk delta", () => {
  it("retains unchanged legacy risk across unrelated benign edits", () => {
    const old = base("    privileged: true\n");
    const next = old.replace("nginx:alpine", "nginx:stable");
    const result = compare(old, next);
    expect(result.requiresApproval).toBe(false);
    expect(result.unchanged.map((item) => item.category)).toEqual(["privileged"]);
  });

  it("distinguishes introduced and removed host risk", () => {
    const safe = base("");
    const risky = base("    privileged: true\n");
    expect(compare(safe, risky).introduced.map((item) => item.category)).toEqual([
      "privileged",
    ]);
    const removed = compare(risky, safe);
    expect(removed.requiresApproval).toBe(false);
    expect(removed.removed.map((item) => item.category)).toEqual(["privileged"]);
  });

  it("considers changed sensitive bind an escalation without leaking its path", () => {
    const previous = base('    volumes:\n      - "/etc:/read:ro"\n');
    const next = base('    volumes:\n      - "/root:/read:ro"\n');
    const delta = compare(previous, next);
    expect(delta.escalated.map((item) => item.category)).toEqual(["host_fs_bind"]);
    expect(delta.requiresApproval).toBe(true);
    expect(JSON.stringify(delta)).not.toMatch(/\/etc|\/root/);
  });

  it("retains identical risky volume despite adding a benign volume", () => {
    const previous = base('    volumes:\n      - "/etc:/read:ro"\n');
    const next = base(
      '    volumes:\n      - "/data:/data:ro"\n      - "/etc:/read:ro"\n',
    );
    expect(compare(previous, next).requiresApproval).toBe(false);
  });

  it("treats capability expansion as escalation and strict reduction as reduced risk", () => {
    const one = base("    cap_add: [SYS_ADMIN]\n");
    const two = base("    cap_add: [SYS_ADMIN, SYS_PTRACE]\n");
    expect(compare(one, two).escalated.map((item) => item.category)).toEqual(["cap_add"]);
    const reduced = compare(two, one);
    expect(reduced.requiresApproval).toBe(false);
    expect(reduced.removed.map((item) => item.category)).toEqual(["cap_add"]);
  });

  it("compares duplicate device findings by exact entry and detects a new one", () => {
    const one = base('    devices:\n      - "/dev/kmsg:/dev/kmsg"\n');
    const two = base(
      '    devices:\n      - "/dev/kmsg:/dev/kmsg"\n      - "/dev/mem:/dev/mem"\n',
    );
    const result = compare(one, two);
    expect(result.unchanged).toHaveLength(1);
    expect(result.introduced).toHaveLength(1);
    expect(result.requiresApproval).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/\/dev\/kmsg|\/dev\/mem/);
  });
});
