import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
const image = "ghcr.io/lvgvs/zimaos-mcp-server";
const digest = `sha256:${"a".repeat(64)}`;
const other = `sha256:${"b".repeat(64)}`;
afterEach(() =>
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function run(args: string[], existing = "", mode = "ok") {
  const dir = mkdtempSync(join(tmpdir(), "image-policy-"));
  dirs.push(dir);
  const state = join(dir, "state");
  const log = join(dir, "calls");
  writeFileSync(state, existing);
  writeFileSync(log, "");
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
if [ "$3" = inspect ]; then
  if [ "$MODE" = auth ]; then echo 'ERROR: unauthorized' >&2; exit 1; fi
  if [ "$MODE" = network ]; then echo 'ERROR: connection timeout' >&2; exit 1; fi
  if [ -s "$STATE" ]; then cat "$STATE"; else echo "ERROR: $4: not found" >&2; exit 1; fi
else
  if [ "$MODE" = wrong ]; then printf '%s' "$OTHER" > "$STATE"; else printf '%s' "$DIGEST" > "$STATE"; fi
fi
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [resolve("scripts/image-policy.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      STATE: state,
      CALLS: log,
      MODE: mode,
      DIGEST: digest,
      OTHER: other,
    },
  });
  return { ...result, calls: readFileSync(log, "utf8") };
}

describe("registry artifact policy (fake Docker registry CLI)", () => {
  it("reuses an existing commit artifact without a write", () => {
    const result = run(["promote", image, digest, "sha-commit", "immutable"], digest);
    expect(result.status).toBe(0);
    expect(result.calls).not.toContain("create");
  });
  it("refuses to overwrite a conflicting commit artifact", () => {
    const result = run(["promote", image, digest, "sha-commit", "immutable"], other);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain("create");
  });
  it("publishes an absent immutable tag from the exact digest", () => {
    const result = run(["promote", image, digest, "sha-commit", "immutable"]);
    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      `create --prefer-index=false --tag ${image}:sha-commit ${image}@${digest}`,
    );
  });
  it.each(["auth", "network"])("does not mistake %s failures for absent tags", (mode) => {
    const result = run(["promote", image, digest, "sha-commit", "immutable"], "", mode);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain("create");
  });
  it("verifies the digest after promotion", () => {
    const result = run(["promote", image, digest, "edge", "mutable"], "", "wrong");
    expect(result.status).not.toBe(0);
  });
  it("promotes mutable aliases without rebuilding", () => {
    const result = run(["promote", image, digest, "edge", "mutable"], other);
    expect(result.status).toBe(0);
    expect(result.calls).toContain("create");
    expect(result.calls).not.toContain("build ");
  });
});
