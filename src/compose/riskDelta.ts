/** Compare existing and proposed Compose risks without exposing source values. */
import { analyzeCompose, type RiskFinding } from "./analyze.js";
import type { ParseComposeResult } from "./parse.js";

export type RiskDeltaStatus = "unchanged" | "removed" | "introduced" | "escalated";
export type RiskDeltaEntry = RiskFinding & { status: RiskDeltaStatus };
export interface ComposeRiskDelta {
  currentFindings: RiskFinding[];
  proposedFindings: RiskFinding[];
  unchanged: RiskDeltaEntry[];
  removed: RiskDeltaEntry[];
  introduced: RiskDeltaEntry[];
  escalated: RiskDeltaEntry[];
  requiresApproval: boolean;
}

/** Canonical internal comparison of bounded Map/array trees; never returned. */
function signature(value: unknown): string {
  if (value instanceof Map) {
    return JSON.stringify(
      [...value.entries()]
        .map(([key, entry]) => [key, signature(entry)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }
  if (Array.isArray(value)) return JSON.stringify(value.map(signature));
  return JSON.stringify(value);
}

function fieldValue(parsed: ParseComposeResult, finding: RiskFinding): unknown {
  if (finding.category === "named_volume_bind") {
    const volumes = parsed.document.get("volumes");
    return volumes instanceof Map ? volumes.get(finding.service) : undefined;
  }
  const services = parsed.document.get("services");
  const service = services instanceof Map ? services.get(finding.service) : undefined;
  return service instanceof Map ? service.get(finding.field) : undefined;
}

/**
 * For per-entry risks, ask the canonical analyzer whether each array entry is
 * risky; do not reimplement its mount/device classification in a second engine.
 */
function signaturesForFinding(
  parsed: ParseComposeResult,
  finding: RiskFinding,
): string[] {
  const value = fieldValue(parsed, finding);
  if (
    Array.isArray(value) &&
    (finding.category === "device_passthrough" ||
      finding.category === "docker_socket" ||
      finding.category === "host_fs_bind")
  ) {
    const entries: string[] = [];
    for (const item of value) {
      const document = new Map<string, unknown>([
        ["services", new Map([[finding.service, new Map([[finding.field, [item]]])]])],
      ]);
      const isolated: ParseComposeResult = { source: "", document };
      if (
        analyzeCompose(isolated).some(
          (risk) => risk.category === finding.category && risk.field === finding.field,
        )
      ) {
        entries.push(signature(item));
      }
    }
    return entries;
  }
  return [signature(value)];
}

function key(finding: RiskFinding): string {
  return JSON.stringify([finding.service, finding.category, finding.field]);
}

function group(findings: RiskFinding[]): Map<string, RiskFinding[]> {
  const groups = new Map<string, RiskFinding[]>();
  for (const finding of findings) {
    const id = key(finding);
    groups.set(id, [...(groups.get(id) ?? []), finding]);
  }
  return groups;
}

/** Analyze both documents, then compare individual risk instances and field values. */
export function compareComposeRisk(
  current: ParseComposeResult,
  proposed: ParseComposeResult,
): ComposeRiskDelta {
  const currentFindings = analyzeCompose(current);
  const proposedFindings = analyzeCompose(proposed);
  if (currentFindings.length > 256 || proposedFindings.length > 256) {
    throw new Error("compose analyze failed: too many risk findings");
  }
  const oldGroups = group(currentFindings);
  const newGroups = group(proposedFindings);
  const unchanged: RiskDeltaEntry[] = [];
  const removed: RiskDeltaEntry[] = [];
  const introduced: RiskDeltaEntry[] = [];
  const escalated: RiskDeltaEntry[] = [];
  for (const [id, oldRisks] of oldGroups) {
    const newRisks = newGroups.get(id) ?? [];
    if (newRisks.length === 0) {
      removed.push(...oldRisks.map((risk) => ({ ...risk, status: "removed" as const })));
      continue;
    }
    const oldSignatures = signaturesForFinding(current, oldRisks[0]!);
    const newSignatures = signaturesForFinding(proposed, newRisks[0]!);
    // An unexpected analyzer/signature mismatch is never evidence that risk
    // stayed unchanged; fail closed rather than treating it as a reduction.
    if (
      oldSignatures.length !== oldRisks.length ||
      newSignatures.length !== newRisks.length
    ) {
      throw new Error("compose analyze failed: risk comparison mismatch");
    }
    if (
      oldRisks.length === 1 &&
      newRisks.length === 1 &&
      ["cap_add", "security_opt", "device_cgroup_rules", "volumes_from"].includes(
        oldRisks[0]!.category,
      )
    ) {
      const previous = fieldValue(current, oldRisks[0]!);
      const next = fieldValue(proposed, newRisks[0]!);
      if (
        Array.isArray(previous) &&
        Array.isArray(next) &&
        next.length < previous.length &&
        next.every((value) =>
          previous.some((item) => signature(item) === signature(value)),
        )
      ) {
        unchanged.push({ ...newRisks[0]!, status: "unchanged" });
        removed.push({ ...oldRisks[0]!, status: "removed" });
        continue;
      }
    }
    const remaining = [...oldSignatures];
    for (const [index, risk] of newRisks.entries()) {
      const match = remaining.indexOf(newSignatures[index]!);
      if (match >= 0) {
        remaining.splice(match, 1);
        unchanged.push({ ...risk, status: "unchanged" });
      } else if (remaining.length === 0) {
        introduced.push({ ...risk, status: "introduced" });
      } else {
        escalated.push({ ...risk, status: "escalated" });
      }
    }
    // Any current instances not retained are removed or replaced.
    for (const value of remaining) {
      const index = oldSignatures.indexOf(value);
      removed.push({ ...oldRisks[index]!, status: "removed" });
    }
  }
  for (const [id, risks] of newGroups) {
    if (!oldGroups.has(id)) {
      introduced.push(
        ...risks.map((risk) => ({ ...risk, status: "introduced" as const })),
      );
    }
  }
  return {
    currentFindings,
    proposedFindings,
    unchanged,
    removed,
    introduced,
    escalated,
    requiresApproval: introduced.length > 0 || escalated.length > 0,
  };
}
