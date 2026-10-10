import { describe, expect, it } from "vitest";
import * as intents from "../src/approval/intent.js";
import * as states from "../src/approval/requestState.js";

const input = {
  source: "name: example-store\nservices:\n  main:\n    image: example/image:latest\n",
  name: "example-store",
  findings: [],
  target: "http://example.test",
  selection: { repoId: "example-store", appId: "com.example.store" },
};

describe("native store approval intent", () => {
  it("rejects changes to any authorized native install dimension", () => {
    const bound = intents.buildStoreInstallIntents(input);
    const changed = [
      { ...input, source: `${input.source}# changed\n` },
      { ...input, name: "example-other" },
      { ...input, target: "http://other.test" },
      { ...input, selection: { ...input.selection, repoId: "other" } },
      { ...input, selection: { ...input.selection, appId: "com.example.other" } },
      {
        ...input,
        findings: [
          {
            category: "host_network",
            service: "main",
            field: "network_mode",
            description: "Host access",
          },
        ],
      },
    ];
    for (const supplied of changed) {
      expect(() => intents.assertStoreInstallIntentsMatch(bound, supplied)).toThrow();
    }
    expect(() =>
      intents.assertStoreInstallIntentsMatch(
        { ...bound, optionsDigest: intents.INSTALL_OPTIONS_DIGEST },
        input,
      ),
    ).toThrow();
    expect(() => intents.assertPendingInstallIntentsMatch(bound, input)).toThrow();
  });

  it("validates a distinct strict expiring store payload and rejects cross-tool state", () => {
    expect(states.parsePendingStoreInstallPayload).toBeTypeOf("function");
    const payload = {
      version: 1,
      tool: "install_app_from_store",
      challengeId: "a".repeat(48),
      ...intents.buildStoreInstallIntents(input),
      expiresAtMs: 2000,
    };
    expect(states.parsePendingStoreInstallPayload(payload, 1000)).toEqual(payload);
    expect(() => states.parsePendingStoreInstallPayload(payload, 2000)).toThrow();
    expect(() =>
      states.parsePendingStoreInstallPayload(
        { ...payload, tool: "install_app_from_compose" },
        1000,
      ),
    ).toThrow();
    expect(() =>
      states.parsePendingStoreInstallPayload({ ...payload, uncontrolled: true }, 1000),
    ).toThrow();
    expect(() =>
      states.parsePendingStoreInstallPayload(
        { ...payload, selectionDigest: "bad" },
        1000,
      ),
    ).toThrow();
    expect(() => states.parsePendingInstallPayload(payload, 1000)).toThrow();
  });
  it("binds final bytes, registered selection and explicit controlled install options", () => {
    expect(intents.buildStoreInstallIntents).toBeTypeOf("function");
    const bound = intents.buildStoreInstallIntents(input);
    expect(bound.contentSha256).toBe(intents.sourceFingerprint(input.source));
    expect(bound.optionsDigest).toBe(
      intents.sha256Hex(
        "POST /v2/app_management/compose?dry_run=false&check_port_conflict=true&uncontrolled=false",
      ),
    );
    expect(bound.optionsDigest).not.toBe(intents.INSTALL_OPTIONS_DIGEST);
    expect(bound.selectionDigest).toBe(
      intents.sha256Hex(JSON.stringify([input.selection.repoId, input.selection.appId])),
    );
    expect(JSON.stringify(bound)).not.toContain(input.source);
    intents.assertStoreInstallIntentsMatch(bound, input);
  });
});
