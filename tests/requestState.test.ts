import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";
import { AppError } from "../src/errors.js";
import { DEFAULT_CHALLENGE_TTL_MS } from "../src/approval/challengeLedger.js";
import {
  createPendingInstallRequestStateCodec,
  parsePendingInstallPayload,
  pendingInstallPayloadSchema,
  REQUEST_STATE_TTL_SECONDS,
  type PendingInstallPayload,
} from "../src/approval/requestState.js";

/**
 * Focused tests for the standalone signed request-state codec factory
 * (`src/approval/requestState.ts`).
 *
 * Coverage: mint/verify round-trip, tamper detection (MAC), expiry (codec TTL
 * via a controlled Date.now and payload-level expiry via an injectable now),
 * context binding (method + injected principal; NOT clientInfo or JSON-RPC id),
 * malformed decoded fields (Zod shape validation independent of the codec),
 * and the guarantee that no raw YAML/secret material can appear in the token.
 * Tokens are never printed: assertions only.
 */

const PRINCIPAL = "deployment-principal-abc"; // opaque, nonsecret fixture
const OTHER_PRINCIPAL = "deployment-principal-def";

/** Fixed sanitized rejection from parsePendingInstallPayload (no echo). */
const INVALID_PAYLOAD_MESSAGE = "The approval request state payload is invalid.";

function makeCodec(principal: string = PRINCIPAL) {
  return createPendingInstallRequestStateCodec({ principal });
}

/** Minimal stand-in for the handler's real ServerContext (cast only; the codec reads mcpReq.method). */
function makeCtx(
  overrides: { method?: string; id?: number | string } = {},
): ServerContext {
  const ctx = {
    sessionId: "session-1",
    mcpReq: {
      id: overrides.id ?? 1,
      method: overrides.method ?? "tools/call",
    },
  };
  return ctx as unknown as ServerContext;
}

function makePayload(
  overrides: Partial<PendingInstallPayload> = {},
): PendingInstallPayload {
  return {
    version: 1,
    challengeId: "0".repeat(48),
    contentSha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    tool: "install_app_from_compose",
    targetDigest: "d".repeat(64),
    optionsDigest: "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    intendedAppName: "myapp",
    riskDisclosureDigest:
      "c1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    expiresAtMs: Date.now() + 300_000,
    ...overrides,
  };
}

async function expectVerifyRejects(
  verify: () => Promise<unknown>,
  reasonCode: string,
): Promise<void> {
  await expect(verify()).rejects.toThrow(new RegExp(`^${reasonCode}$`));
}

function expectInvalidPayload(value: unknown, nowMs?: number): void {
  try {
    parsePendingInstallPayload(value, nowMs);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw new Error(`expected AppError, got ${String(error)}`);
    }
    expect(error.code).toBe("INPUT_INVALID");
    // Exact fixed message: any input content leaking in would break this.
    expect(error.message).toBe(INVALID_PAYLOAD_MESSAGE);
    return;
  }
  throw new Error("expected rejection");
}

/** Decode the clear-text body of a wire token (signed, not encrypted — expected). */
function decodeTokenBody(token: string): Record<string, unknown> {
  const dot = token.lastIndexOf(".");
  expect(dot).toBeGreaterThan(3);
  const body = Buffer.from(token.slice(3, dot), "base64url").toString("utf8");
  return JSON.parse(body) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("factory and signing key", () => {
  it("shares the centralized 300s TTL with the ledger constant", () => {
    expect(DEFAULT_CHALLENGE_TTL_MS).toBe(300_000);
    expect(REQUEST_STATE_TTL_SECONDS).toBe(Math.floor(DEFAULT_CHALLENGE_TTL_MS / 1000));
    expect(REQUEST_STATE_TTL_SECONDS).toBe(300);
  });

  it("rejects a missing or oversized principal (fail closed)", () => {
    expect(() => createPendingInstallRequestStateCodec({ principal: "" })).toThrow(
      RangeError,
    );
    expect(() =>
      createPendingInstallRequestStateCodec({ principal: "x".repeat(257) }),
    ).toThrow(RangeError);
  });

  it("generates an independent key per factory: cross-factory verify fails with 'mac'", async () => {
    const codecA = makeCodec(PRINCIPAL);
    const codecB = makeCodec(OTHER_PRINCIPAL);
    const payload = makePayload();
    const ctx = makeCtx();

    const tokenA = await codecA.mint(payload, ctx);
    const tokenB = await codecB.mint(payload, ctx);
    // Independent random keys => different MACs even for identical payloads.
    expect(tokenA).not.toBe(tokenB);

    await expectVerifyRejects(() => codecB.verify(tokenA, ctx), "mac");
  });

  it("requires the handler context at mint time because binding is configured", async () => {
    const codec = makeCodec();
    await expect(codec.mint(makePayload())).rejects.toThrow(TypeError);
  });
});

describe("mint/verify round-trip", () => {
  it("verifies a minted token and returns the exact payload", async () => {
    const codec = makeCodec();
    const payload = makePayload();
    const ctx = makeCtx();

    const token = await codec.mint(payload, ctx);
    expect(typeof token).toBe("string");
    // Documented SDK wire shape: "v1." prefix (no deeper format asserted).
    expect(token.startsWith("v1.")).toBe(true);

    const decoded = await codec.verify(token, ctx);
    expect(decoded).toEqual(payload);
  });

  it("verifies under a different JSON-RPC id and session (not bound)", async () => {
    const codec = makeCodec();
    const payload = makePayload();
    const token = await codec.mint(payload, makeCtx({ method: "tools/call", id: 7 }));

    // Same method + principal, different JSON-RPC id / session fields.
    const other = {
      sessionId: "session-2",
      mcpReq: { id: 99, method: "tools/call" },
    } as unknown as ServerContext;
    await expect(codec.verify(token, other)).resolves.toEqual(payload);
  });
});

describe("tamper detection", () => {
  it("rejects a tampered payload body with 'mac'", async () => {
    const codec = makeCodec();
    const token = await codec.mint(makePayload(), makeCtx());
    const dot = token.lastIndexOf(".");
    const mid = 3 + Math.floor((dot - 3) / 2);
    const flipped = token[mid] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, mid)}${flipped}${token.slice(mid + 1)}`;

    await expectVerifyRejects(() => codec.verify(tampered, makeCtx()), "mac");
  });

  it("rejects a tampered MAC with 'mac'", async () => {
    const codec = makeCodec();
    const token = await codec.mint(makePayload(), makeCtx());
    const last = token.length - 1;
    const flipped = token[last] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, last)}${flipped}`;

    await expectVerifyRejects(() => codec.verify(tampered, makeCtx()), "mac");
  });

  it("rejects garbage and empty strings with 'malformed'", async () => {
    const codec = makeCodec();
    const ctx = makeCtx();
    for (const state of ["", "not-a-token", "v1."]) {
      await expectVerifyRejects(() => codec.verify(state, ctx), "malformed");
    }
  });
});

describe("expiry", () => {
  it("keeps a token valid inside the centralized TTL and expired after it (codec level)", async () => {
    const baseMs = 1_700_000_000_000; // aligned to a whole second
    const nowSpy = vi.spyOn(Date, "now");

    const codec = makeCodec();
    const payload = makePayload({ expiresAtMs: baseMs + 300_000 });
    const ctx = makeCtx();

    nowSpy.mockReturnValue(baseMs);
    const token = await codec.mint(payload, ctx);

    // Still inside the 300s TTL.
    nowSpy.mockReturnValue(baseMs + 299_000);
    await expect(codec.verify(token, ctx)).resolves.toEqual(payload);

    // Past the TTL: fail closed with 'expired'.
    nowSpy.mockReturnValue(baseMs + 301_000);
    await expectVerifyRejects(() => codec.verify(token, ctx), "expired");
  });

  it("rejects a payload whose own expiry has passed (schema level, injectable now)", () => {
    const payload = makePayload({ expiresAtMs: 2_000_000_000 });

    expect(parsePendingInstallPayload(payload, 1_999_999_999)).toEqual(payload);
    // Boundary is fail-closed, matching the ledger's `now >= expiresAtMs`.
    expectInvalidPayload(payload, 2_000_000_000);
    expectInvalidPayload(payload, 2_000_000_001);
  });
});

describe("context binding", () => {
  it("rejects a token echoed under a different method with 'bind'", async () => {
    const codec = makeCodec();
    const payload = makePayload();
    const token = await codec.mint(payload, makeCtx({ method: "tools/call" }));

    await expectVerifyRejects(
      () => codec.verify(token, makeCtx({ method: "resources/read" })),
      "bind",
    );
  });

  it("rejects a token from another factory (different principal) with 'mac'", async () => {
    const codecA = makeCodec(PRINCIPAL);
    const codecB = makeCodec(OTHER_PRINCIPAL);
    const payload = makePayload();
    const ctx = makeCtx();

    const token = await codecA.mint(payload, ctx);
    await expectVerifyRejects(() => codecB.verify(token, ctx), "mac");
  });
});

describe("malformed decoded fields (Zod shape validation)", () => {
  it("accepts a well-formed payload and returns typed data", () => {
    const payload = makePayload();
    expect(parsePendingInstallPayload(payload)).toEqual(payload);
    expect(pendingInstallPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    ["missing version", (p) => delete p.version],
    ["missing challengeId", (p) => delete p.challengeId],
    ["missing contentSha256", (p) => delete p.contentSha256],
    ["missing tool", (p) => delete p.tool],
    ["missing targetDigest", (p) => delete p.targetDigest],
    ["missing optionsDigest", (p) => delete p.optionsDigest],
    ["missing intendedAppName", (p) => delete p.intendedAppName],
    ["missing riskDisclosureDigest", (p) => delete p.riskDisclosureDigest],
    ["missing expiresAtMs", (p) => delete p.expiresAtMs],
  ] as [string, (p: Record<string, unknown>) => void][])(
    "rejects %s",
    (_label, mutate) => {
      const payload = makePayload() as Record<string, unknown>;
      mutate(payload);
      expectInvalidPayload(payload);
    },
  );

  it("rejects an unexpected extra field (strict shape)", () => {
    const payload = makePayload();
    expectInvalidPayload({ ...payload, surprise: "x" });
  });

  it.each([
    ["wrong version", { version: 2 }],
    ["version as string", { version: "1" }],
    ["short challengeId", { challengeId: "abc123" }],
    [
      "uppercase challengeId",
      { challengeId: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" },
    ],
    ["contentSha256 63 chars", { contentSha256: "a".repeat(63) }],
    ["uppercase contentSha256", { contentSha256: "A".repeat(64) }],
    ["non-hex optionsDigest", { optionsDigest: "g".repeat(64) }],
    ["wrong tool", { tool: "some_other_tool" }],
    ["empty targetDigest", { targetDigest: "" }],
    ["invalid targetDigest", { targetDigest: "h".repeat(64) }],
    ["empty intendedAppName", { intendedAppName: "" }],
    ["expiresAtMs as string", { expiresAtMs: "2000000000" }],
    ["negative expiresAtMs", { expiresAtMs: -1 }],
    ["zero expiresAtMs", { expiresAtMs: 0 }],
    ["fractional expiresAtMs", { expiresAtMs: 1.5 }],
  ] as [string, Partial<PendingInstallPayload>][])("rejects %s", (_label, overrides) => {
    expectInvalidPayload(makePayload(overrides));
  });

  it("rejects non-object decoded values", () => {
    for (const value of [null, undefined, "", "string", 42, true, [], NaN]) {
      expectInvalidPayload(value);
    }
  });
});

describe("no raw YAML or secret material in the token", () => {
  it("carries exactly the narrow payload fields on the wire (nothing else)", async () => {
    const codec = makeCodec();
    const payload = makePayload();
    const token = await codec.mint(payload, makeCtx());

    const body = decodeTokenBody(token);
    expect(Object.keys(body).sort()).toEqual(["b", "exp", "p"]);
    expect(Object.keys(body["p"] as Record<string, unknown>).sort()).toEqual(
      [
        "challengeId",
        "contentSha256",
        "expiresAtMs",
        "intendedAppName",
        "optionsDigest",
        "riskDisclosureDigest",
        "targetDigest",
        "tool",
        "version",
      ].sort(),
    );
  });

  it("never contains representative YAML or secret material", async () => {
    const codec = makeCodec();
    const payload = makePayload({ intendedAppName: "myapp" });
    const token = await codec.mint(payload, makeCtx());

    for (const sentinel of [
      "services:",
      "image: nginx",
      "password=supersecret",
      "ZIMAOS_API_KEY",
      "Bearer ",
    ]) {
      expect(token.includes(sentinel)).toBe(false);
    }
  });
});
