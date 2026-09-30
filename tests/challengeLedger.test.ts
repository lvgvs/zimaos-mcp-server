import { describe, expect, it } from "vitest";
import {
  ChallengeLedger,
  DEFAULT_CHALLENGE_TTL_MS,
  defaultChallengeLedger,
} from "../src/approval/challengeLedger.js";
import type { ChallengeBinding } from "../src/approval/challengeLedger.js";
import { AppError } from "../src/errors.js";

/**
 * Focused tests for the standalone bounded process-wide single-use challenge
 * ledger (`src/approval/challengeLedger.ts`).
 *
 * All timing is driven by an injectable fake clock so expiry behavior is
 * deterministic. Rejections assert exact sanitized messages: any binding or
 * id content leaking into a message would break the assertion (no-echo /
 * no-oracle guarantee).
 */

const REJECTED =
  "This approval challenge cannot be used (unknown, expired, already consumed, or mismatched).";
const CAPACITY_EXHAUSTED =
  "Challenge capacity is exhausted; no further challenges can be issued.";

interface FakeClock {
  now: () => number;
  advanceMs: (ms: number) => void;
}

function makeClock(startMs = 1_000_000): FakeClock {
  let t = startMs;
  return {
    now: () => t,
    advanceMs: (ms: number) => {
      t += ms;
    },
  };
}

function makeLedger(options: ConstructorParameters<typeof ChallengeLedger>[0] = {}): {
  ledger: ChallengeLedger;
  clock: FakeClock;
} {
  const clock = makeClock();
  return { ledger: new ChallengeLedger({ ...options, now: clock.now }), clock };
}

function expectRejected(fn: () => void, message: string): asserts fn is never {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw new Error(`expected AppError, got ${String(error)}`);
    }
    expect(error.message).toBe(message);
    return;
  }
  throw new Error("expected rejection");
}

const BINDING: ChallengeBinding = {
  tool: "zimaos.compose.apply",
  contentFingerprint: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  principal: "principal-abc",
};

describe("issuance", () => {
  it("issues cryptographically random hex ids (24 bytes / 48 chars), unique per call", () => {
    const { ledger } = makeLedger();
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const record = ledger.issue({});
      expect(record.id).toMatch(/^[0-9a-f]{48}$/);
      expect(seen.has(record.id)).toBe(false);
      seen.add(record.id);
    }
  });

  it("applies the centralized default TTL of 300 seconds", () => {
    expect(DEFAULT_CHALLENGE_TTL_MS).toBe(300_000);
    const clock = makeClock();
    const ledger = new ChallengeLedger({ now: clock.now });
    const record = ledger.issue({});
    expect(record.issuedAtMs).toBe(clock.now());
    expect(record.expiresAtMs).toBe(clock.now() + 300_000);
  });

  it("honors an injected TTL and stores a copy of the binding", () => {
    const clock = makeClock();
    const ledger = new ChallengeLedger({ ttlMs: 60_000, now: clock.now });
    const input: ChallengeBinding = { tool: "t" };
    const record = ledger.issue(input);
    expect(record.expiresAtMs).toBe(clock.now() + 60_000);
    input.tool = "mutated-after-issue";
    expect(record.binding.tool).toBe("t");
    // The returned record is also a copy: mutating it must not corrupt state.
    (record.binding as { tool?: string }).tool = "mutated-record";
    expect(ledger.inspect(record.id)).toEqual({
      state: "pending",
      expiresAtMs: clock.now() + 60_000,
    });
  });

  it("rejects non-positive ttl/capacity options (fail closed)", () => {
    const clock = makeClock();
    expect(() => new ChallengeLedger({ ttlMs: 0, now: clock.now })).toThrow(RangeError);
    expect(() => new ChallengeLedger({ maxPending: -1, now: clock.now })).toThrow(
      RangeError,
    );
    expect(() => new ChallengeLedger({ maxConsumed: 0.5, now: clock.now })).toThrow(
      RangeError,
    );
  });
});

describe("expiry", () => {
  it("reports pending before expiry and expired at/after the boundary", () => {
    const { ledger, clock } = makeLedger({ ttlMs: 1_000 });
    const record = ledger.issue(BINDING);
    expect(ledger.inspect(record.id)).toEqual({
      state: "pending",
      expiresAtMs: clock.now() + 1_000,
    });
    clock.advanceMs(999); // t = issuedAt + 999 < expiry
    expect(ledger.inspect(record.id).state).toBe("pending");
    clock.advanceMs(1); // exactly at expiresAtMs -> expired (fail closed)
    expect(ledger.inspect(record.id)).toEqual({ state: "expired" });
  });

  it("rejects consuming an expired challenge and then reports unknown", () => {
    const { ledger, clock } = makeLedger({ ttlMs: 1_000 });
    const record = ledger.issue(BINDING);
    clock.advanceMs(1_001);
    expectRejected(() => ledger.consume(record.id, BINDING), REJECTED);
    // The dead entry was removed; from now on it is unknown.
    expect(ledger.inspect(record.id)).toEqual({ state: "unknown" });
  });

  it("purgeExpired removes only expired pending entries and reports the count", () => {
    const { ledger, clock } = makeLedger({ ttlMs: 1_000 });
    const a = ledger.issue(BINDING);
    clock.advanceMs(500);
    const b = ledger.issue(BINDING); // expires later than a
    expect(ledger.purgeExpired()).toBe(0);
    clock.advanceMs(600); // a expired, b still live (1_100 < 1_500)
    expect(ledger.purgeExpired()).toBe(1);
    expect(ledger.inspect(a.id)).toEqual({ state: "unknown" });
    expect(ledger.inspect(b.id).state).toBe("pending");
    // Live pending entries survive purge.
    clock.advanceMs(2_000);
    expect(ledger.purgeExpired()).toBe(1);
  });

  it("expired-but-not-yet-purged ids still reject on consume (no window where expiry is ignored)", () => {
    const { ledger, clock } = makeLedger({ ttlMs: 1_000 });
    const record = ledger.issue(BINDING);
    clock.advanceMs(1_001); // past expiry, but nobody has purged yet
    expectRejected(() => ledger.consume(record.id, BINDING), REJECTED);
  });
});

describe("binding mismatch", () => {
  it("rejects a wrong fingerprint without consuming the challenge", () => {
    const { ledger } = makeLedger();
    const record = ledger.issue(BINDING);
    expectRejected(
      () =>
        ledger.consume(record.id, {
          ...BINDING,
          contentFingerprint: "f".repeat(64),
        }),
      REJECTED,
    );
    // Not consumed: still pending and consumable with the exact binding.
    expect(ledger.inspect(record.id).state).toBe("pending");
    const consumed = ledger.consume(record.id, BINDING);
    expect(consumed.id).toBe(record.id);
  });

  it("rejects missing or extra bound fields (fail closed both directions)", () => {
    const { ledger } = makeLedger();
    const record = ledger.issue(BINDING);
    // Missing field on the provided side.
    expectRejected(() => ledger.consume(record.id, { tool: BINDING.tool }), REJECTED);
    // Extra field not bound at issuance.
    expectRejected(
      () =>
        ledger.consume(record.id, {
          ...BINDING,
          principal: "principal-abc",
          extra: "x",
        } as ChallengeBinding),
      REJECTED,
    );
    expect(ledger.inspect(record.id).state).toBe("pending");
  });

  it("rejects an empty binding when the challenge was issued with one (and vice versa)", () => {
    const { ledger } = makeLedger();
    const bound = ledger.issue(BINDING);
    expectRejected(() => ledger.consume(bound.id, {}), REJECTED);
    const unbound = ledger.issue({});
    expectRejected(
      () => ledger.consume(unbound.id, { tool: "zimaos.compose.apply" }),
      REJECTED,
    );
  });

  it("never reflects binding values or ids in rejection messages", () => {
    const { ledger } = makeLedger();
    const record = ledger.issue(BINDING);
    for (const attempt of [
      () => ledger.consume(record.id, {}),
      () => ledger.consume(record.id, { ...BINDING, principal: "principal-xyz" }),
      () => ledger.consume("does-not-exist", BINDING),
    ]) {
      try {
        attempt();
        throw new Error("expected rejection");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toBe(REJECTED);
        for (const secret of [BINDING.tool!, BINDING.contentFingerprint!, record.id]) {
          expect(message.includes(secret)).toBe(false);
        }
      }
    }
  });
});

describe("single-use consume", () => {
  it("consumes exactly once: second use rejects as replayed", () => {
    const { ledger } = makeLedger();
    const record = ledger.issue(BINDING);
    expect(ledger.consume(record.id, BINDING).id).toBe(record.id);
    expect(ledger.inspect(record.id)).toEqual({ state: "consumed" });
    expectRejected(() => ledger.consume(record.id, BINDING), REJECTED);
  });

  it("rejects unknown ids with the same fixed message (no oracle)", () => {
    const { ledger } = makeLedger();
    expectRejected(() => ledger.consume("0".repeat(48), {}), REJECTED);
    expectRejected(() => ledger.consume("", {}), REJECTED);
  });

  it("unknown, expired, replayed, and mismatched all reject with one identical message", () => {
    const { ledger, clock } = makeLedger({ ttlMs: 1_000 });
    const record = ledger.issue(BINDING);
    const messages: string[] = [];
    for (const fn of [
      () => ledger.consume("f".repeat(48), {}), // unknown
      () => {
        clock.advanceMs(2_000);
        ledger.consume(record.id, BINDING); // expired
      },
      () => {
        const fresh = ledger.issue(BINDING);
        ledger.consume(fresh.id, BINDING);
        ledger.consume(fresh.id, BINDING); // replayed
      },
      () => {
        const fresh2 = ledger.issue(BINDING);
        ledger.consume(fresh2.id, {}); // mismatch (not consumed)
      },
    ]) {
      try {
        fn();
        throw new Error("expected rejection");
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
    }
    expect(messages).toEqual([REJECTED, REJECTED, REJECTED, REJECTED]);
  });

  it("consume returns a copy of the record with its binding", () => {
    const { ledger } = makeLedger();
    const record = ledger.issue(BINDING);
    const consumed = ledger.consume(record.id, BINDING);
    expect(consumed).toEqual({ ...record });
    (consumed.binding as { tool?: string }).tool = "mutated";
    expect(ledger.inspect(record.id)).toEqual({ state: "consumed" });
  });
});

describe("bounded capacity", () => {
  it("fails closed when live pending capacity is exhausted; no eviction of live entries", () => {
    const { ledger } = makeLedger({ maxPending: 2 });
    const a = ledger.issue(BINDING);
    const b = ledger.issue(BINDING);
    expectRejected(() => ledger.issue(BINDING), CAPACITY_EXHAUSTED);
    // Both live challenges remain usable.
    expect(ledger.inspect(a.id).state).toBe("pending");
    expect(ledger.inspect(b.id).state).toBe("pending");
  });

  it("purges expired entries first so dead state never blocks issuance", () => {
    const { ledger, clock } = makeLedger({ maxPending: 2, ttlMs: 1_000 });
    const a = ledger.issue(BINDING);
    ledger.issue(BINDING); // second live entry, also expires at t+1000
    expectRejected(() => ledger.issue(BINDING), CAPACITY_EXHAUSTED);
    clock.advanceMs(1_001); // both expired
    const c = ledger.issue(BINDING); // purge freed capacity
    expect(c.id).not.toBe(a.id);
    expect(ledger.stats()).toEqual({ pending: 1, consumed: 0 });
  });

  it("bounds consumed records; evicted ids still reject replay (never re-issued)", () => {
    const { ledger } = makeLedger({ maxConsumed: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const record = ledger.issue(BINDING);
      ledger.consume(record.id, BINDING);
      ids.push(record.id);
    }
    expect(ledger.stats()).toEqual({ pending: 0, consumed: 2 });
    // Oldest two were evicted from the replay-proof set; they are still
    // rejected because their pending entries are gone and ids never repeat.
    for (const id of ids) {
      expectRejected(() => ledger.consume(id, BINDING), REJECTED);
    }
  });

  it("stats() tracks bounded counters without exposing ids or bindings", () => {
    const { ledger } = makeLedger({ maxPending: 4 });
    const a = ledger.issue(BINDING);
    ledger.issue(BINDING); // second live entry (id not needed below)
    expect(ledger.stats()).toEqual({ pending: 2, consumed: 0 });
    ledger.consume(a.id, BINDING);
    expect(ledger.stats()).toEqual({ pending: 1, consumed: 1 });
    ledger.purgeExpired(); // no-op when nothing expired
    expect(ledger.stats()).toEqual({ pending: 1, consumed: 1 });
  });
});

describe("process-wide sharing across consumers", () => {
  /** Simulated consumer (e.g. an MCP tool handler) over a shared ledger. */
  class Consumer {
    constructor(private readonly ledger: ChallengeLedger) {}
    issue(binding: ChallengeBinding): string {
      return this.ledger.issue(binding).id;
    }
    consume(id: string, binding: ChallengeBinding): void {
      this.ledger.consume(id, binding);
    }
  }

  it("one process-wide ledger is shared by every consumer in the process", () => {
    // The module-level default is a single instance for the whole process;
    // re-importing the same specifier must yield the identical object.
    expect(defaultChallengeLedger).toBeInstanceOf(ChallengeLedger);
    const consumerA = new Consumer(defaultChallengeLedger);
    const consumerB = new Consumer(defaultChallengeLedger);

    const id = consumerA.issue(BINDING);
    // Issued by A, verified+consumed by B: exactly once.
    expect(() => consumerB.consume(id, BINDING)).not.toThrow();
    // Replay through a third path (C) is rejected even though C never saw it.
    const consumerC = new Consumer(defaultChallengeLedger);
    expectRejected(() => consumerC.consume(id, BINDING), REJECTED);
  });

  it("expiry and capacity are enforced across consumers via the shared clock", () => {
    const clock = makeClock();
    const ledger = new ChallengeLedger({ maxPending: 1, ttlMs: 1_000, now: clock.now });
    const consumerA = new Consumer(ledger);
    const consumerB = new Consumer(ledger);

    const id = consumerA.issue(BINDING);
    // B cannot issue while A's challenge is live (shared capacity).
    expectRejected(() => consumerB.issue({}), CAPACITY_EXHAUSTED);
    clock.advanceMs(1_001);
    // After expiry, the shared ledger purges and B can issue again.
    const id2 = consumerB.issue(BINDING);
    expect(id2).not.toBe(id);
    // A's expired challenge is still rejected for B (no cross-consumer reuse).
    expectRejected(() => consumerA.consume(id, BINDING), REJECTED);
  });

  it("default ledger uses the real clock and default bounds", () => {
    const before = Date.now();
    const record = defaultChallengeLedger.issue({});
    const after = Date.now();
    expect(record.issuedAtMs).toBeGreaterThanOrEqual(before);
    expect(record.issuedAtMs).toBeLessThanOrEqual(after);
    expect(record.expiresAtMs - record.issuedAtMs).toBe(DEFAULT_CHALLENGE_TTL_MS);
  });
});
