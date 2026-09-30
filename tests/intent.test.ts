import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RiskFinding } from "../src/compose/analyze.js";
import { AppError } from "../src/errors.js";
import { pendingInstallPayloadSchema } from "../src/approval/requestState.js";
import {
  assertPendingInstallIntentsMatch,
  buildPendingInstallIntents,
  INSTALL_OPTIONS_DIGEST,
  RISK_POLICY_VERSION,
  riskDisclosureDigest,
  sha256Hex,
  sourceFingerprint,
  targetIdentityDigest,
} from "../src/approval/intent.js";

/**
 * Focused tests for the deterministic install-intent digests
 * (`src/approval/intent.ts`).
 *
 * Coverage: exact UTF-8 byte fingerprint (whitespace and Unicode form matter),
 * target identity digest (raw URL never appears in state), the fixed real-POST
 * options digest, the normalized risk-disclosure digest over findings + policy
 * version, and the construct/compare helper that rejects changed content,
 * name, target, options, or findings/policy with fixed sanitized AppErrors.
 */

/** Independent SHA-256 (lowercase hex) for cross-checking module output. */
function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const SOURCE =
  [
    "name: myapp",
    "services:",
    "  app:",
    "    image: example/app:1.0",
    "    privileged: true",
  ].join("\n") + "\n";

const NAME = "myapp";

const TARGET = "https://zima.example.lan:32400";

const FINDINGS: [RiskFinding, RiskFinding] = [
  {
    category: "privileged_mode",
    service: "app",
    field: "privileged",
    description: "The container runs in privileged mode.",
  },
  {
    category: "host_network",
    service: "app",
    field: "network_mode",
    description: "The container uses the host network namespace.",
  },
];

const REAL_INSTALL_REQUEST_LINE =
  "POST /v2/app_management/compose?dry_run=false&check_port_conflict=true";

/** Fixed sanitized rejections (must match src/approval/intent.ts exactly). */
const CONTENT_CHANGED_MESSAGE =
  "The compose document does not match the approved install.";
const NAME_CHANGED_MESSAGE = "The application name does not match the approved install.";
const TARGET_CHANGED_MESSAGE =
  "The deployment target does not match the approved install.";
const OPTIONS_CHANGED_MESSAGE = "The install options do not match the approved install.";
const RISK_DISCLOSURE_CHANGED_MESSAGE =
  "The risk disclosure does not match the approved install.";

function expectAppError(fn: () => void, message: string): AppError {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw new Error(`expected AppError, got ${String(error)}`);
    }
    expect(error.code).toBe("INPUT_INVALID");
    // Exact fixed message: any input content leaking in would break this.
    expect(error.message).toBe(message);
    return error;
  }
  throw new Error("expected rejection");
}

function canonicalFindingsDocument(
  findings: RiskFinding[],
  policyVersion: string,
): string {
  return JSON.stringify({
    findings: findings.map((f) => ({
      category: f.category,
      description: f.description,
      field: f.field,
      service: f.service,
    })),
    policyVersion,
  });
}

describe("source fingerprint (exact UTF-8 bytes)", () => {
  it("is deterministic and equals an independent SHA-256 of the exact bytes", () => {
    expect(sourceFingerprint(SOURCE)).toBe(sha256(SOURCE));
    expect(sourceFingerprint(SOURCE)).toBe(sourceFingerprint(SOURCE));
  });

  it("changes when whitespace changes (byte-exact, no normalization)", () => {
    const base = sourceFingerprint(SOURCE);
    const trailingSpace = SOURCE + "  \n";
    const crlf = SOURCE.replace(/\n/g, "\r\n");
    const leadingNewline = "\n" + SOURCE;
    expect(sourceFingerprint(trailingSpace)).not.toBe(base);
    expect(sourceFingerprint(crlf)).not.toBe(base);
    expect(sourceFingerprint(leadingNewline)).not.toBe(base);
    // Each variant still matches its own exact-byte hash.
    expect(sourceFingerprint(trailingSpace)).toBe(sha256(trailingSpace));
    expect(sourceFingerprint(crlf)).toBe(sha256(crlf));
  });

  it("preserves Unicode bytes: composed and decomposed forms differ", () => {
    const composed = "name: café\n"; // é as U+00E9 (composed)
    const decomposed = "name: cafe\u0301\n"; // e + combining acute accent
    expect(composed.charCodeAt(9)).toBe(0x00e9);
    expect(decomposed.charCodeAt(9)).toBe(0x0065);
    expect(decomposed.charCodeAt(10)).toBe(0x0301);
    const a = sourceFingerprint(composed);
    const b = sourceFingerprint(decomposed);
    expect(a).not.toBe(b);
    expect(a).toBe(sha256(composed));
    expect(b).toBe(sha256(decomposed));
  });

  it("hashes the empty string to the well-known SHA-256 of zero bytes", () => {
    expect(sourceFingerprint("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("target identity digest (never raw URL in state)", () => {
  it("is deterministic and equals an independent SHA-256 of the target", () => {
    expect(targetIdentityDigest(TARGET)).toBe(sha256(TARGET));
    expect(targetIdentityDigest(TARGET)).toBe(targetIdentityDigest(TARGET));
  });

  it("differs per distinct target identity", () => {
    const base = targetIdentityDigest(TARGET);
    expect(targetIdentityDigest("https://zima.example.lan:32401")).not.toBe(base);
    expect(targetIdentityDigest("https://other.example.lan:32400")).not.toBe(base);
  });

  it("never exposes the raw target in constructed payload fields", () => {
    const intents = buildPendingInstallIntents({
      source: SOURCE,
      name: NAME,
      findings: FINDINGS,
      target: TARGET,
    });
    expect(JSON.stringify(intents)).not.toContain(TARGET);
    for (const value of Object.values(intents)) {
      expect(value).not.toBe(TARGET);
    }
  });
});

describe("fixed install options digest", () => {
  it("is the SHA-256 of the canonical real install request line", () => {
    expect(INSTALL_OPTIONS_DIGEST).toBe(sha256(REAL_INSTALL_REQUEST_LINE));
    expect(INSTALL_OPTIONS_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });

  it("can never equal a dry-run variant of the options", () => {
    const dryRunLine =
      "POST /v2/app_management/compose?dry_run=true&check_port_conflict=true";
    expect(INSTALL_OPTIONS_DIGEST).not.toBe(sha256(dryRunLine));
  });

  it("is always what buildPendingInstallIntents binds", () => {
    const intents = buildPendingInstallIntents({
      source: SOURCE,
      name: NAME,
      findings: FINDINGS,
      target: TARGET,
    });
    expect(intents.optionsDigest).toBe(INSTALL_OPTIONS_DIGEST);
  });
});

describe("risk disclosure digest (normalized findings + policy version)", () => {
  it("is deterministic and equals an independent hash of the normalized document", () => {
    const expected = sha256(canonicalFindingsDocument(FINDINGS, RISK_POLICY_VERSION));
    expect(riskDisclosureDigest(FINDINGS)).toBe(expected);
    expect(riskDisclosureDigest(FINDINGS)).toBe(expected);
  });

  it("changes when a finding is modified", () => {
    const base = riskDisclosureDigest(FINDINGS);
    const modified: RiskFinding[] = [
      { ...FINDINGS[0] },
      { ...FINDINGS[1], description: "A different disclosure text." },
    ];
    expect(riskDisclosureDigest(modified)).not.toBe(base);
  });

  it("is order-sensitive over the supplied findings", () => {
    const base = riskDisclosureDigest(FINDINGS);
    expect(riskDisclosureDigest([FINDINGS[1], FINDINGS[0]])).not.toBe(base);
  });

  it("changes when the policy version changes", () => {
    const base = riskDisclosureDigest(FINDINGS, RISK_POLICY_VERSION);
    expect(riskDisclosureDigest(FINDINGS, "2")).not.toBe(base);
  });

  it("normalizes: extra keys on a finding do not change the digest", () => {
    const withExtra = [{ ...FINDINGS[0], extra: "ignored" } as RiskFinding, FINDINGS[1]];
    expect(riskDisclosureDigest(withExtra)).toBe(riskDisclosureDigest(FINDINGS));
  });

  it("rejects a malformed finding with a fixed sanitized AppError", () => {
    const bad = [{ ...FINDINGS[0] }] as RiskFinding[];
    delete (bad[0] as unknown as Record<string, unknown>).description;
    expectAppError(
      () => riskDisclosureDigest(bad),
      "The supplied risk findings are invalid.",
    );
  });
});

describe("build/compare pending-install payload fields", () => {
  const SUPPLIED = { source: SOURCE, name: NAME, findings: FINDINGS, target: TARGET };

  it("constructs exactly the supplied source/name/findings/target digests", () => {
    const intents = buildPendingInstallIntents(SUPPLIED);
    expect(intents.contentSha256).toBe(sha256(SOURCE));
    expect(intents.intendedAppName).toBe(NAME);
    expect(intents.targetDigest).toBe(sha256(TARGET));
    expect(intents.optionsDigest).toBe(INSTALL_OPTIONS_DIGEST);
    expect(intents.riskDisclosureDigest).toBe(
      sha256(canonicalFindingsDocument(FINDINGS, RISK_POLICY_VERSION)),
    );
  });

  it("fields satisfy the pending-install payload schema", () => {
    const intents = buildPendingInstallIntents(SUPPLIED);
    const parsed = pendingInstallPayloadSchema.safeParse({
      version: 1,
      challengeId: "0".repeat(48),
      tool: "install_app_from_compose",
      ...intents,
      expiresAtMs: Date.now() + 300_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the exact supplied values (no throw)", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    expect(() => assertPendingInstallIntentsMatch(bound, SUPPLIED)).not.toThrow();
  });

  it("rejects changed content bytes with a fixed message and no source echo", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    for (const changed of [SOURCE + "  \n", "\r\n" + SOURCE, SOURCE.slice(0, -2)]) {
      const error = expectAppError(
        () => assertPendingInstallIntentsMatch(bound, { ...SUPPLIED, source: changed }),
        CONTENT_CHANGED_MESSAGE,
      );
      expect(error.message).not.toContain("myapp");
      expect(error.message).not.toContain(TARGET);
    }
  });

  it("rejects a renamed app with a fixed message and no source echo", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    const error = expectAppError(
      () => assertPendingInstallIntentsMatch(bound, { ...SUPPLIED, name: "other" }),
      NAME_CHANGED_MESSAGE,
    );
    expect(error.message).not.toContain("myapp");
  });

  it("rejects a changed target identity with a fixed message and no source echo", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    const error = expectAppError(
      () =>
        assertPendingInstallIntentsMatch(bound, {
          ...SUPPLIED,
          target: "https://zima.example.lan:32401",
        }),
      TARGET_CHANGED_MESSAGE,
    );
    expect(error.message).not.toContain(TARGET);
  });

  it("rejects changed options with a fixed message and no source echo", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    const tamperedOptions = { ...bound, optionsDigest: "0".repeat(64) };
    const error = expectAppError(
      () => assertPendingInstallIntentsMatch(tamperedOptions, SUPPLIED),
      OPTIONS_CHANGED_MESSAGE,
    );
    expect(error.message).not.toContain("myapp");
  });

  it("rejects changed findings/policy with a fixed message and no source echo", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    // Findings changed at re-entry time.
    const modifiedFindings: RiskFinding[] = [
      FINDINGS[0],
      { ...FINDINGS[1], description: "A different disclosure text." },
    ];
    expectAppError(
      () =>
        assertPendingInstallIntentsMatch(bound, {
          ...SUPPLIED,
          findings: modifiedFindings,
        }),
      RISK_DISCLOSURE_CHANGED_MESSAGE,
    );
    // Policy version changed at issuance time (bound digest uses "2").
    const policyChanged = {
      ...bound,
      riskDisclosureDigest: riskDisclosureDigest(FINDINGS, "2"),
    };
    expectAppError(
      () => assertPendingInstallIntentsMatch(policyChanged, SUPPLIED),
      RISK_DISCLOSURE_CHANGED_MESSAGE,
    );
  });

  it("rejects an empty supplied name with a fixed message", () => {
    const bound = buildPendingInstallIntents(SUPPLIED);
    expectAppError(
      () => assertPendingInstallIntentsMatch(bound, { ...SUPPLIED, name: "" }),
      NAME_CHANGED_MESSAGE,
    );
  });

  it("sha256Hex is a plain exact-UTF-8 helper", () => {
    expect(sha256Hex(SOURCE)).toBe(sha256(SOURCE));
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
