/**
 * Bounded process-wide single-use challenge ledger (Phase 2D slice).
 *
 * Standalone in-memory state for short-lived, exactly-once approval challenges
 * that gate risky mutations (docs/RESEARCH.md section C: "Keep a bounded
 * process-wide pending/consumed challenge ledger"). This module is
 * deliberately independent of the MCP SDK, tool wiring, and ZimaOS calls; it
 * exposes a minimal typed API for the later signed-state integration.
 *
 * Guarantees:
 * - Challenge IDs are cryptographically random (24 bytes / 192 bits, hex).
 * - Pending challenges carry an expiry; the centralized default TTL is 300
 *   seconds and the clock is injectable for deterministic tests.
 * - Both pending and consumed capacity are bounded. Issuance fails closed when
 *   live pending capacity is exhausted (expired entries are purged first);
 *   consumed records are evicted oldest-first only after they have already
 *   served their single-use purpose, so replay of an evicted id still rejects
 *   (fresh random ids make a collision negligibly likely).
 * - `consume` verifies the challenge and atomically consumes it exactly once:
 *   unknown, expired, replayed, or binding-mismatched challenges all reject
 *   with one fixed message that reflects no input content. A mismatch does
 *   not consume; only a fully valid consume removes the pending entry.
 * - Records store only the opaque id, timestamps, and caller-supplied
 *   nonsecret digests/metadata (e.g. an exact-content SHA-256 fingerprint).
 *   Original YAML/Compose text and credentials must never be passed in; this
 *   module neither logs nor echoes binding values.
 * - There is no retry anywhere: a failed or consumed challenge is gone, and
 *   callers must obtain a fresh issuance for any further mutation.
 */

import { randomBytes } from "node:crypto";
import { AppError } from "../errors.js";

/** Centralized default challenge lifetime: 300 seconds (docs/RESEARCH.md C). */
export const DEFAULT_CHALLENGE_TTL_MS = 300_000;

const DEFAULT_PENDING_CAPACITY = 1024;
const DEFAULT_CONSUMED_CAPACITY = 8192;
/** 24 random bytes -> 192-bit entropy, rendered as 48 hex characters. */
const CHALLENGE_ID_BYTES = 24;

/** Fixed sanitized rejection: reflects no input content (no oracle). */
const REJECTED_MESSAGE =
  "This approval challenge cannot be used (unknown, expired, already consumed, or mismatched).";

/** Fixed sanitized message: live pending capacity is exhausted. */
const PENDING_CAPACITY_MESSAGE =
  "Challenge capacity is exhausted; no further challenges can be issued.";

export interface ChallengeLedgerOptions {
  /** Pending lifetime in milliseconds. Default: `DEFAULT_CHALLENGE_TTL_MS` (300s). */
  ttlMs?: number;
  /** Maximum live pending challenges held at once. Default: 1024. */
  maxPending?: number;
  /** Maximum consumed records retained for replay proof. Default: 8192. */
  maxConsumed?: number;
  /** Injectable clock returning epoch milliseconds (deterministic tests). */
  now?: () => number;
}

/**
 * Nonsecret binding metadata stored with a challenge. Callers pass digests or
 * opaque identifiers only — never original YAML/Compose text, secrets, or
 * credentials. All fields are optional; whatever is bound at issuance must be
 * re-supplied exactly on consume (fail-closed).
 */
export interface ChallengeBinding {
  /** Opaque operation/tool identifier the challenge authorizes. */
  tool?: string;
  /** Hex SHA-256 fingerprint of the exact original content under review. */
  contentFingerprint?: string;
  /** Opaque authenticated deployment principal identifier (nonsecret). */
  principal?: string;
}

/** A pending or consumed challenge as stored by the ledger. */
export interface ChallengeRecord {
  readonly id: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  /** Nonsecret binding digests/metadata (never original content). */
  readonly binding: Readonly<ChallengeBinding>;
}

/**
 * Current state of a challenge id. "expired" means it was pending and has now
 * passed its expiry; after physical purge an expired id reports "unknown".
 * Both reject identically on consume.
 */
export type ChallengeState =
  | { readonly state: "pending"; readonly expiresAtMs: number }
  | { readonly state: "consumed" }
  | { readonly state: "expired" }
  | { readonly state: "unknown" };

type PendingEntry = ChallengeRecord;

interface ConsumedEntry {
  readonly id: string;
  readonly consumedAtMs: number;
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

/**
 * In-memory bounded single-use challenge ledger.
 *
 * Process-wide sharing: every consumer in this server process (MCP tool
 * handlers, later signed-state verification) must use the same instance — see
 * `defaultChallengeLedger`. The ledger is independent of MCP server instances
 * and holds no ZimaOS or credential material.
 */
export class ChallengeLedger {
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly maxConsumed: number;
  private readonly now: () => number;

  /** Insertion-ordered live pending entries (bounded by `maxPending`). */
  private readonly pending = new Map<string, PendingEntry>();
  /** Insertion-ordered consumed records (bounded by `maxConsumed`). */
  private readonly consumed = new Map<string, ConsumedEntry>();

  constructor(options: ChallengeLedgerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.maxPending = options.maxPending ?? DEFAULT_PENDING_CAPACITY;
    this.maxConsumed = options.maxConsumed ?? DEFAULT_CONSUMED_CAPACITY;
    assertPositiveInteger(this.ttlMs, "ttlMs");
    assertPositiveInteger(this.maxPending, "maxPending");
    assertPositiveInteger(this.maxConsumed, "maxConsumed");
    this.now = options.now ?? Date.now;
  }

  /**
   * Issue a new pending challenge. Purges expired entries first so dead state
   * never blocks issuance, then fails closed (AppError INTERNAL) when live
   * pending capacity is exhausted — no eviction of live challenges.
   */
  issue(binding: ChallengeBinding = {}): ChallengeRecord {
    this.purgeExpired();
    if (this.pending.size >= this.maxPending) {
      throw new AppError("INTERNAL", PENDING_CAPACITY_MESSAGE);
    }
    const issuedAtMs = this.now();
    const record: PendingEntry = {
      id: randomBytes(CHALLENGE_ID_BYTES).toString("hex"),
      issuedAtMs,
      expiresAtMs: issuedAtMs + this.ttlMs,
      binding: { ...binding },
    };
    this.pending.set(record.id, record);
    return { ...record, binding: { ...record.binding } };
  }

  /**
   * Current state of a challenge id (non-consuming). Expired is computed
   * lazily; physical removal happens in `purgeExpired` or on consume.
   */
  inspect(id: string): ChallengeState {
    if (this.consumed.has(id)) return { state: "consumed" };
    const entry = this.pending.get(id);
    if (entry === undefined) return { state: "unknown" };
    if (this.now() >= entry.expiresAtMs) return { state: "expired" };
    return { state: "pending", expiresAtMs: entry.expiresAtMs };
  }

  /**
   * Verify a pending challenge and atomically consume it exactly once.
   *
   * - unknown / expired / replayed (already consumed) -> AppError INPUT_INVALID
   *   with the fixed `REJECTED_MESSAGE`;
   * - binding mismatch (any bound field differs, including fields present on
   *   only one side) -> same rejection WITHOUT consuming: a wrong guess cannot
   *   burn a valid challenge;
   * - success -> pending entry removed, consumed record retained for replay
   *   proof, returns the record.
   *
   * Callers must invoke this immediately before the mutation it authorizes and
   * never retry after failure or uncertainty.
   */
  consume(id: string, binding: ChallengeBinding = {}): ChallengeRecord {
    const nowMs = this.now();
    if (this.consumed.has(id)) {
      throw new AppError("INPUT_INVALID", REJECTED_MESSAGE);
    }
    const entry = this.pending.get(id);
    if (entry === undefined) {
      throw new AppError("INPUT_INVALID", REJECTED_MESSAGE);
    }
    if (nowMs >= entry.expiresAtMs) {
      // Remove the dead entry; from now on it reports "unknown".
      this.pending.delete(id);
      throw new AppError("INPUT_INVALID", REJECTED_MESSAGE);
    }
    if (!bindingsMatch(entry.binding, binding)) {
      throw new AppError("INPUT_INVALID", REJECTED_MESSAGE);
    }

    this.pending.delete(id);
    const consumedAtMs = nowMs;
    // Evict oldest-first only when over capacity: evicted ids were already
    // consumed once and a fresh random id makes re-issuance negligible;
    // without a pending entry, replay still rejects.
    while (this.consumed.size >= this.maxConsumed) {
      const oldest = this.consumed.keys().next().value;
      if (oldest === undefined) break;
      this.consumed.delete(oldest);
    }
    this.consumed.set(id, { id, consumedAtMs });

    return { ...entry, binding: { ...entry.binding } };
  }

  /**
   * Safely purge expired pending entries and trim consumed records to capacity.
   * Never touches live pending or unconsumed state; returns the number of
   * expired pending entries removed.
   */
  purgeExpired(): number {
    const nowMs = this.now();
    let purged = 0;
    for (const [id, entry] of this.pending) {
      if (entry.expiresAtMs <= nowMs) {
        this.pending.delete(id);
        purged += 1;
      }
    }
    while (this.consumed.size > this.maxConsumed) {
      const oldest = this.consumed.keys().next().value;
      if (oldest === undefined) break;
      this.consumed.delete(oldest);
    }
    return purged;
  }

  /** Bounded counters for observability; never exposes ids or bindings. */
  stats(): { pending: number; consumed: number } {
    return { pending: this.pending.size, consumed: this.consumed.size };
  }
}

/**
 * Process-wide default ledger shared by every consumer in this server process
 * (independent of MCP server instances). Restart loses all state — intended:
 * outstanding approvals must not survive a restart.
 */
export const defaultChallengeLedger = new ChallengeLedger();

function bindingsMatch(
  stored: Readonly<ChallengeBinding>,
  provided: Readonly<ChallengeBinding>,
): boolean {
  const keys = new Set<string>([...Object.keys(stored), ...Object.keys(provided)]);
  for (const key of keys) {
    const a = (stored as Record<string, string | undefined>)[key];
    const b = (provided as Record<string, string | undefined>)[key];
    if (a !== b) return false;
  }
  return true;
}
