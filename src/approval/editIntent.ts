import { AppError } from "../errors.js";
import type { ComposeRiskDelta } from "../compose/riskDelta.js";
import { sha256Hex, sourceFingerprint, targetIdentityDigest } from "./intent.js";
import type { PendingEditPayload } from "./requestState.js";

export const EDIT_OPTIONS_DIGEST = sha256Hex(
  "PUT /v2/app_management/compose/{id}?dry_run=false&check_port_conflict=true",
);

/** Bind the complete disclosed structured risk delta, never the YAML values. */
export function editRiskDigest(risks: ComposeRiskDelta): string {
  return sha256Hex(JSON.stringify({ policy: "edit-1", risks }));
}

export function buildEditIntents(input: {
  id: string;
  baseFingerprint: string;
  source: string;
  risks: ComposeRiskDelta;
  target: string;
}): Pick<
  PendingEditPayload,
  | "appId"
  | "baseFingerprint"
  | "contentSha256"
  | "targetDigest"
  | "optionsDigest"
  | "riskDisclosureDigest"
> {
  return {
    appId: input.id,
    baseFingerprint: input.baseFingerprint,
    contentSha256: sourceFingerprint(input.source),
    targetDigest: targetIdentityDigest(input.target),
    optionsDigest: EDIT_OPTIONS_DIGEST,
    riskDisclosureDigest: editRiskDigest(input.risks),
  };
}

export function assertEditIntentsMatch(
  state: PendingEditPayload,
  input: Parameters<typeof buildEditIntents>[0],
): void {
  const expected = buildEditIntents(input);
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (state[key] !== expected[key]) {
      throw new AppError("INPUT_INVALID", "The approved Compose edit no longer matches.");
    }
  }
}
