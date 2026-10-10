/**
 * Standalone signed request-state codec for pending install approvals
 * (Phase 2D slice).
 *
 * Wraps the official SDK `createRequestStateCodec` (protocol revision
 * 2026-07-28 multi-round-trip `requestState`) so a risky mutation can be
 * re-entered with an integrity-protected, context-bound payload instead of
 * trusting client-echoed input. This module is deliberately independent of
 * MCP tool wiring, the install flow, ledger consumption, and HTTP auth; it
 * only defines the narrow typed payload, its fail-closed validation, and a
 * factory for the signed codec.
 *
 * Guarantees:
 * - The signing key is an ephemeral random 32-byte (256-bit) value generated
 *   once per factory call (i.e. once per process in normal use). It is never
 *   persisted, derived from credentials, or shared across factories; a token
 *   minted by one factory cannot be verified by another.
 * - The TTL is the centralized 300 seconds shared with the challenge ledger
 *   (`DEFAULT_CHALLENGE_TTL_MS`), so codec expiry and ledger expiry stay in
 *   lockstep.
 * - Context binding covers exactly two values: `ctx.mcpReq.method` (the
 *   originating method, e.g. "tools/call") and an explicitly injected opaque
 *   deployment principal identifier. It deliberately does NOT bind
 *   clientInfo or the JSON-RPC id; a token minted under one method/principal
 *   is rejected when echoed under another ("bind" failure). The binding value
 *   itself never appears in the wire string (the SDK stores only an
 *   HMAC-derived tag).
 * - The codec is signed, not encrypted: the payload body is readable by any
 *   holder of the token. Therefore the payload carries ONLY nonsecret
 *   identity/digest fields — never original YAML/Compose text, secrets, or
 *   credentials (see `PendingInstallPayload`).
 * - `parsePendingInstallPayload` validates an untrusted decoded payload shape
 *   with Zod independently of the codec: the SDK proves MAC/expiry/binding;
 *   this schema proves structure. Both must pass before any authorization
 *   decision, and both fail closed with one fixed message that reflects no
 *   input content.
 */

import { randomBytes } from "node:crypto";
import {
  createRequestStateCodec,
  type RequestStateCodec,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "../errors.js";
import { DEFAULT_CHALLENGE_TTL_MS } from "./challengeLedger.js";

/** Centralized request-state TTL in seconds, shared with the ledger's 300s default. */
export const REQUEST_STATE_TTL_SECONDS = Math.floor(DEFAULT_CHALLENGE_TTL_MS / 1000);

/** Ephemeral per-factory HMAC key size: exactly the SDK minimum (256 bits). */
const SIGNING_KEY_BYTES = 32;
/** Bound on the opaque principal identifier length (defense only, not a format). */
const MAX_PRINCIPAL_LENGTH = 256;

/** Fixed sanitized rejection: reflects no input content (no oracle). */
const INVALID_PAYLOAD_MESSAGE = "The approval request state payload is invalid.";

/** Lowercase hex SHA-256 digest (64 chars) — a fingerprint, never the content. */
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The narrow typed pending-install request-state payload. Every field is
 * nonsecret identity or a digest of something else; there is deliberately no
 * free-text field where YAML, secrets, or credentials could ride along.
 */
export const pendingInstallPayloadSchema = z
  .object({
    /** Schema version discriminator (currently only 1). */
    version: z.literal(1),
    /** Ledger challenge id this state authorizes (24 random bytes / 48 hex chars). */
    challengeId: z.string().regex(/^[0-9a-f]{48}$/),
    /** SHA-256 of the exact original content under review. */
    contentSha256: sha256HexSchema,
    /** The operation/tool this state authorizes (only the install tool). */
    tool: z.literal("install_app_from_compose"),
    /** SHA-256 of the deployment target identity (no host URL in readable state). */
    targetDigest: sha256HexSchema,
    /** SHA-256 of the canonical fixed options bound at issuance. */
    optionsDigest: sha256HexSchema,
    /** Intended safe application name shown to the user (no raw content). */
    intendedAppName: z.string().min(1).max(256),
    /** SHA-256 of the risk/disclosure text presented for confirmation. */
    riskDisclosureDigest: sha256HexSchema,
    /** Epoch milliseconds after which this state must not be honored. */
    expiresAtMs: z.number().int().positive(),
  })
  .strict();

export type PendingInstallPayload = z.infer<typeof pendingInstallPayloadSchema>;

/** Same integrity/expiry/principal channel; a different operation and exact catalog pair. */
export const pendingStoreInstallPayloadSchema = pendingInstallPayloadSchema.extend({
  tool: z.literal("install_app_from_store"),
  selectionDigest: sha256HexSchema,
});
export type PendingStoreInstallPayload = z.infer<typeof pendingStoreInstallPayloadSchema>;

export function parsePendingStoreInstallPayload(
  decoded: unknown,
  nowMs: number = Date.now(),
): PendingStoreInstallPayload {
  const parsed = pendingStoreInstallPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.expiresAtMs <= nowMs) {
    throw new AppError("INPUT_INVALID", INVALID_PAYLOAD_MESSAGE);
  }
  return parsed.data;
}

/** Same signed, short-lived state channel for an exact existing-app edit. */
export const pendingEditPayloadSchema = z
  .object({
    version: z.literal(1),
    challengeId: z.string().regex(/^[0-9a-f]{48}$/),
    tool: z.literal("edit_app_compose"),
    appId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    baseFingerprint: sha256HexSchema,
    contentSha256: sha256HexSchema,
    targetDigest: sha256HexSchema,
    optionsDigest: sha256HexSchema,
    riskDisclosureDigest: sha256HexSchema,
    expiresAtMs: z.number().int().positive(),
  })
  .strict();
export type PendingEditPayload = z.infer<typeof pendingEditPayloadSchema>;
export function parsePendingEditPayload(
  decoded: unknown,
  nowMs: number = Date.now(),
): PendingEditPayload {
  const parsed = pendingEditPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.expiresAtMs <= nowMs) {
    throw new AppError("INPUT_INVALID", INVALID_PAYLOAD_MESSAGE);
  }
  return parsed.data;
}

/**
 * Validate an untrusted decoded request-state payload before authorization.
 *
 * The codec's `verify` already proved MAC/expiry/binding; this independently
 * proves the decoded shape (and that its own expiry has not passed, as
 * defense in depth alongside the codec TTL and ledger TTL). Any failure
 * throws AppError INPUT_INVALID with a fixed message — never an echo of the
 * offending value.
 */
export function parsePendingInstallPayload(
  decoded: unknown,
  nowMs: number = Date.now(),
): PendingInstallPayload {
  const parsed = pendingInstallPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError("INPUT_INVALID", INVALID_PAYLOAD_MESSAGE);
  }
  // Fail closed at the boundary, matching the ledger's `now >= expiresAtMs`.
  if (parsed.data.expiresAtMs <= nowMs) {
    throw new AppError("INPUT_INVALID", INVALID_PAYLOAD_MESSAGE);
  }
  return parsed.data;
}

export interface PendingInstallRequestStateCodecOptions {
  /**
   * Opaque, nonsecret identifier of this deployment's single authenticated
   * MCP principal. Injected explicitly by the wiring layer — never derived
   * from clientInfo or request metadata. Bound into every token together
   * with `ctx.mcpReq.method`.
   */
  principal: string;
}

/**
 * Create a signed request-state codec for pending install approvals.
 *
 * - Generates one ephemeral random 32-byte signing key per call (per process
 *   in normal use); tokens are valid only until process restart or TTL.
 * - Binds `ctx.mcpReq.method` and the injected principal; because a bind
 *   callback is configured, both `mint` and `verify` require the handler's
 *   real `ServerContext`.
 * - Uses the centralized 300s TTL shared with the challenge ledger.
 */
export function createPendingInstallRequestStateCodec(
  options: PendingInstallRequestStateCodecOptions,
): RequestStateCodec<
  PendingInstallPayload | PendingEditPayload | PendingStoreInstallPayload
> {
  if (
    typeof options.principal !== "string" ||
    options.principal.length === 0 ||
    options.principal.length > MAX_PRINCIPAL_LENGTH
  ) {
    throw new RangeError("principal must be a nonempty string of at most 256 characters");
  }
  const key = randomBytes(SIGNING_KEY_BYTES);
  return createRequestStateCodec<
    PendingInstallPayload | PendingEditPayload | PendingStoreInstallPayload
  >({
    key,
    ttlSeconds: REQUEST_STATE_TTL_SECONDS,
    bind: (ctx) => `${ctx.mcpReq.method}\u0000${options.principal}`,
  });
}
