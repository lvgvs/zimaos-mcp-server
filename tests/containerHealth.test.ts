import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

// Exercise the actual Dockerfile health command with local HTTP only: no Docker/VM in CI.
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const healthLine = dockerfile.match(/^ {2}CMD (\[.*\])$/m)?.[1];
if (!healthLine) throw new Error("Expected an exec-form Docker healthcheck.");
const healthCommand = JSON.parse(healthLine) as string[];

describe("production container health command", () => {
  it.each([
    { status: 200, body: '{"ready":true}', exit: 0 },
    { status: 200, body: '{"ready":false}', exit: 1 },
    { status: 503, body: '{"ready":false}', exit: 1 },
    { status: 503, body: '{"ready":true}', exit: 1 },
    { status: 200, body: "{}", exit: 1 },
    { status: 200, body: "SYNTHETIC_SECRET", exit: 1 },
  ])(
    "requires explicit readiness and HTTP success: $status $body",
    async (sample) => {
      const server = createServer((req, res) => {
        expect(req.url).toBe("/health");
        expect(req.headers.authorization).toBeUndefined();
        res.writeHead(sample.status, { "Content-Type": "application/json" });
        res.end(sample.body);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected local TCP server.");
      let output = "";
      try {
        expect(healthCommand[0]).toBe("node");
        const child = spawn(process.execPath, healthCommand.slice(1), {
          env: { ...process.env, PORT: ` ${address.port} ` },
          timeout: 6_000,
        });
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        const [exitCode] = await once(child, "close");
        expect(exitCode).toBe(sample.exit);
        expect(output).toBe("");
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    10_000,
  );
});
