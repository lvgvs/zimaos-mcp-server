import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";

const directory = mkdtempSync(join(tmpdir(), "zimaos-startup-"));
const build = join(directory, "build");
const syntheticPassword = "SYNTHETIC_PASSWORD";
const syntheticToken = "SYNTHETIC_TOKEN_0123456789abcdef0123456789abcdef";

beforeAll(() => {
  const compiled = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--outDir", build],
    { encoding: "utf8" },
  );
  expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  symlinkSync(
    join(process.cwd(), "node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  copyFileSync(join(process.cwd(), "package.json"), join(directory, "package.json"));
}, 20_000);

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function runStartup(
  overrides: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(build, "index.js")], {
      env: {
        PATH: process.env.PATH,
        ZIMAOS_URL: "http://zimaos.test",
        ZIMAOS_USERNAME: "synthetic-user",
        ZIMAOS_PASSWORD: syntheticPassword,
        MCP_AUTH_TOKEN: syntheticToken,
        ...overrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("startup child did not terminate"));
    }, 5_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("real compiled startup process", () => {
  it("rejects malformed secret-bearing config without reflecting values", async () => {
    const result = await runStartup({ ZIMAOS_URL: `malformed-${syntheticPassword}` });
    expect(result.code).toBe(1);
    expect(result.output).toContain("ZIMAOS_URL");
    expect(result.output).not.toContain(syntheticPassword);
    expect(result.output).not.toContain(syntheticToken);
  });

  it("normalizes listener failure rather than printing an internal stack", async () => {
    const upstream = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          success: true,
          data: { token: { access_token: "synthetic-session" } },
        }),
      );
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address() as AddressInfo;
    try {
      const result = await runStartup({
        ZIMAOS_URL: `http://127.0.0.1:${port}`,
        PORT: String(port),
      });
      expect(result.code).toBe(1);
      expect(result.output).toContain("fatal_startup_error");
      expect(result.output).not.toContain("node:net");
      expect(result.output).not.toContain(syntheticPassword);
      expect(result.output).not.toContain(syntheticToken);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
