import { describe, expect, it, vi } from "vitest";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { PermissionLayer } from "../src/permissions.js";
import { ChallengeLedger } from "../src/approval/challengeLedger.js";
import { buildStoreInstallIntents } from "../src/approval/intent.js";
import type { PendingStoreInstallPayload } from "../src/approval/requestState.js";
import { readInstalledStoreAssociation } from "../src/zimaos/storeCatalog.js";

const enabled = new PermissionLayer({ allowAppControl: false, allowAppInstall: true });
function harness(suffix: string) {
  const selection = { repoId: "example", appId: `com.example.${suffix}` };
  const name = `store-${suffix}`;
  const source = `name: ${name}\nx-casaos:\n  id: ${selection.appId}\nservices:\n  main:\n    image: example/image:latest\n`;
  const client = new ZimaOsClient({
    baseUrl: "http://example.test",
    username: "test",
    password: "synthetic",
    fetchImpl: async () => {
      throw new Error("unexpected network");
    },
  });
  const repos = vi
    .spyOn(client, "getStoreRepositories")
    .mockResolvedValue([
      { id: selection.repoId, enabled: true, version: "v2", transport: "http" },
    ]);
  vi.spyOn(client, "getAppManagementArchitecture").mockResolvedValue("amd64");
  vi.spyOn(client, "getStoreAppDetail").mockResolvedValue({
    id: selection.appId,
    repo_id: selection.repoId,
    type: "compose",
    architectures: ["amd64"],
    source: {
      compose_arch: "amd64",
      compose_path: `/apps/${selection.appId}/docker-compose.amd64.yml`,
      compose_architectures: {
        amd64: { path: `/apps/${selection.appId}/docker-compose.amd64.yml` },
      },
    },
  });
  const compose = vi.spyOn(client, "getStoreCompose").mockResolvedValue(source);
  const list = vi.spyOn(client, "listComposeApps").mockResolvedValue({});
  const yaml = vi.spyOn(client, "getComposeAppYaml");
  vi.spyOn(client, "getComposeAppAssociation").mockImplementation(async (id) =>
    readInstalledStoreAssociation(await client.getComposeAppYaml(id)),
  );
  const dryRun = vi
    .spyOn(client, "validateNativeStoreCompose")
    .mockResolvedValue({ status: "accepted", accepted: true });
  const mutation = vi
    .spyOn(client, "installNativeStoreComposeOnce")
    .mockResolvedValue({ status: "accepted", accepted: true });
  return {
    service: new AppService(client),
    client,
    selection,
    name,
    source,
    repos,
    compose,
    list,
    yaml,
    dryRun,
    mutation,
  };
}

describe("native store service integration", () => {
  it("shares serialization and name reservations with generic installs across service instances", async () => {
    const h = harness("mixed-concurrent");
    const generic = new AppService(h.client);
    const genericMutation = vi.spyOn(h.client, "installComposeOnce");
    vi.spyOn(h.client, "validateCompose").mockResolvedValue({
      status: "accepted",
      accepted: true,
    });
    const outcomes = await Promise.allSettled([
      h.service.installStoreApp(h.selection, enabled),
      generic.installSafeCompose(h.source, enabled),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.mutation).toHaveBeenCalledTimes(1);
    expect(genericMutation).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { bad: null },
    Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`app-${i}`, {}])),
  ])("fails closed on invalid or excessive installed listing %j", async (listing) => {
    const h = harness(
      `bad-list-${Array.isArray(listing) ? "array" : listing === null ? "null" : Object.keys(listing).length}`,
    );
    h.list.mockResolvedValue(listing);
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
    expect(h.dryRun).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it.each([
    "x-casaos: null",
    "x-casaos: {repo_id: example}",
    "x-casaos: {id: INVALID}",
    "x-meta: &identity {id: com.example.other}\nx-casaos: *identity",
  ])("rejects opaque or ambiguous installed metadata: %s", async (metadata) => {
    const h = harness(`metadata-${metadata.length}`);
    h.list.mockResolvedValue({ existing: {} });
    h.yaml.mockResolvedValue(`name: existing\n${metadata}\nservices: {}\n`);
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("keeps ambiguous thrown mutation reserved and never retries", async () => {
    const h = harness("throw-uncertain");
    h.mutation.mockRejectedValue(new Error("uncertain"));
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toThrow();
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toThrow();
    expect(h.mutation).toHaveBeenCalledTimes(1);
  });
  it("allows a new attempt only after definitive rejection", async () => {
    const h = harness("definitive-rejection");
    h.mutation.mockResolvedValueOnce({ status: "rejected", accepted: false });
    expect(await h.service.installStoreApp(h.selection, enabled)).toEqual({
      status: "rejected",
      accepted: false,
    });
    expect(await h.service.installStoreApp(h.selection, enabled)).toMatchObject({
      status: "accepted",
    });
    expect(h.mutation).toHaveBeenCalledTimes(2);
  });
  it("bounds observations and distinguishes unavailable readback from rejection", async () => {
    const h = harness("unknown-readback");
    h.list.mockResolvedValueOnce({}).mockRejectedValue(new Error("read unavailable"));
    expect(await h.service.installStoreApp(h.selection, enabled)).toMatchObject({
      status: "accepted",
      accepted: true,
      reconciliation: "unknown",
    });
    expect(h.list).toHaveBeenCalledTimes(2);
    expect(h.mutation).toHaveBeenCalledTimes(1);
  });
  it("requires approval of final bytes, fresh-resolves them and rejects replay", async () => {
    const h = harness("approved");
    const risky = h.source.replace(
      "image: example/image:latest",
      "image: example/image:latest\n    privileged: true",
    );
    h.compose.mockResolvedValue(risky);
    const first = await h.service.installStoreApp(h.selection, enabled);
    expect(first.status).toBe("confirmation_required");
    if (first.status !== "confirmation_required") throw new Error("expected disclosure");
    expect(first.source).toContain("repo_id: example");
    expect(h.mutation).not.toHaveBeenCalled();
    const intents = buildStoreInstallIntents({
      source: first.source,
      name: first.name,
      findings: first.findings,
      target: "http://example.test",
      selection: h.selection,
    });
    const ledger = new ChallengeLedger();
    const challenge = ledger.issue({
      tool: "install_app_from_store",
      contentFingerprint: intents.contentSha256,
      principal: "test-principal",
    });
    const state: PendingStoreInstallPayload = {
      version: 1,
      tool: "install_app_from_store",
      ...intents,
      challengeId: challenge.id,
      expiresAtMs: challenge.expiresAtMs,
    };
    h.compose.mockResolvedValueOnce(`${risky}# changed\n`);
    await expect(
      h.service.installApprovedStoreApp(
        h.selection,
        enabled,
        state,
        "http://example.test",
        "test-principal",
        ledger,
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(h.mutation).not.toHaveBeenCalled();
    expect(
      await h.service.installApprovedStoreApp(
        h.selection,
        enabled,
        state,
        "http://example.test",
        "test-principal",
        ledger,
      ),
    ).toMatchObject({ accepted: true });
    expect(h.mutation).toHaveBeenCalledWith(first.source);
    expect(h.mutation).toHaveBeenCalledTimes(1);
    await expect(
      h.service.installApprovedStoreApp(
        h.selection,
        enabled,
        state,
        "http://example.test",
        "test-principal",
        ledger,
      ),
    ).rejects.toThrow();
    expect(h.mutation).toHaveBeenCalledTimes(1);
  });
  it("denies default-off before any catalog reads", async () => {
    const h = harness("denied");
    await expect(
      h.service.installStoreApp(
        h.selection,
        new PermissionLayer({ allowAppControl: false }),
      ),
    ).rejects.toMatchObject({ code: "APP_INSTALL_DISABLED" });
    expect(h.repos).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("analyzes and dry-runs final associated bytes and submits exactly once", async () => {
    const h = harness("safe");
    const result = await h.service.installStoreApp(h.selection, enabled);
    expect(result).toMatchObject({
      status: "accepted",
      accepted: true,
      reconciliation: "pending",
    });
    expect(result).not.toHaveProperty("source");
    expect(h.mutation).toHaveBeenCalledTimes(1);
    const finalSource = h.dryRun.mock.calls[0]?.[0];
    expect(finalSource).toContain("repo_id: example");
    expect(h.mutation).toHaveBeenCalledWith(finalSource);
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
    });
    expect(h.mutation).toHaveBeenCalledTimes(1);
  });
  it("awaits installed canonical association scan before any dry-run or mutation", async () => {
    const h = harness("associated");
    h.list.mockResolvedValue({ existing: {} });
    let release!: (source: string) => void;
    h.yaml.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const install = h.service.installStoreApp(h.selection, enabled);
    await vi.waitFor(() => expect(h.yaml).toHaveBeenCalled());
    expect(h.dryRun).not.toHaveBeenCalled();
    release(h.source.replace(h.name, "existing"));
    await expect(install).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect(h.dryRun).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("permits an unrelated installed association", async () => {
    const h = harness("unrelated");
    h.list.mockResolvedValueOnce({ existing: {} });
    h.yaml.mockResolvedValue(
      "name: existing\nx-casaos:\n  id: com.other.app\nservices:\n  main:\n    image: example/other\n",
    );
    expect(await h.service.installStoreApp(h.selection, enabled)).toMatchObject({
      accepted: true,
    });
    expect(h.yaml).toHaveBeenCalledTimes(1);
  });
  it.each([
    "x-casaos: scalar",
    "x-casaos:\n  repo_id: example",
    "x-casaos:\n  id: [ambiguous]",
  ])("fails closed on ambiguous association %s", async (metadata) => {
    const h = harness(`ambiguous-${metadata.length}`);
    h.list.mockResolvedValue({ existing: {} });
    h.yaml.mockResolvedValue(
      `name: existing\n${metadata}\nservices:\n  main:\n    image: example/other\n`,
    );
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toMatchObject({
      code: "ZIMAOS_UPSTREAM_ERROR",
    });
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("propagates resolver failure without install traffic", async () => {
    const h = harness("resolverfail");
    h.repos.mockRejectedValue(new Error("synthetic"));
    await expect(h.service.installStoreApp(h.selection, enabled)).rejects.toThrow();
    expect(h.dryRun).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
  });
});
