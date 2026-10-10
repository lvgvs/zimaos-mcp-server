/**
 * Focused tests for the read-only store Compose resolver (Phase 6 slice).
 *
 * All fixtures are synthetic; no real VM, candidate, or secret material.
 * No network: the resolver is exercised against an injected, typed fake
 * read client whose calls are recorded in order.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { resolveStoreCompose } from "../src/zimaos/storeResolver.js";
import type { StoreDetail, StoreSelection } from "../src/zimaos/storeCatalog.js";

const SEL: StoreSelection = { repoId: "community", appId: "com.example.test" };

type CallName = "repos" | "arch" | "detail" | "compose";

/** The resolver's injected client surface: exactly the four catalog reads. */
export interface FakeReadClient {
  getStoreRepositories: () => Promise<unknown>;
  getAppManagementArchitecture: () => Promise<string>;
  getStoreAppDetail: (selection: StoreSelection) => Promise<unknown>;
  getStoreCompose: (detail: StoreDetail) => Promise<string>;
  /** Ordered record of the reads actually performed. */
  calls: CallName[];
}

function makeFakeClient(opts: {
  repos?: unknown;
  arch?: string;
  detail?: unknown;
  compose?: string;
  fail?: Partial<Record<CallName, AppError>>;
} = {}): FakeReadClient {
  const calls: CallName[] = [];
  const next = (name: CallName): void => {
    calls.push(name);
    const failure = opts.fail?.[name];
    if (failure !== undefined) throw failure;
  };
  return {
    calls,
    getStoreRepositories() {
      next("repos");
      return Promise.resolve(opts.repos);
    },
    getAppManagementArchitecture() {
      next("arch");
      return Promise.resolve(opts.arch ?? "amd64");
    },
    getStoreAppDetail() {
      next("detail");
      return Promise.resolve(opts.detail);
    },
    getStoreCompose() {
      next("compose");
      return Promise.resolve(opts.compose ?? "");
    },
  };
}

async function expectAppError(
  promise: Promise<unknown>,
  code: string,
): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      expect(err.code).toBe(code);
      return err;
    }
    throw new Error(`Expected AppError ${code}, got: ${String(err)}`);
  }
  throw new Error(`Expected AppError ${code}, but the promise resolved`);
}

// ---------------------------------------------------------------------------
// Selection is asserted BEFORE any catalog traffic
// ---------------------------------------------------------------------------

describe("resolveStoreCompose — selection validation before traffic", () => {
  it("rejects an unsafe repository id with INPUT_INVALID and performs zero reads", async () => {
    const client = makeFakeClient({ repos: [], detail: {}, compose: "name: x" });
    const err = await expectAppError(
      resolveStoreCompose(client, { repoId: "https://example.test", appId: SEL.appId }),
      "INPUT_INVALID",
    );
    expect(err.message).not.toContain("example.test");
    expect(client.calls).toEqual([]);
  });

  it("rejects a non-canonical app id with INPUT_INVALID and performs zero reads", async () => {
    const client = makeFakeClient({ repos: [], detail: {}, compose: "name: x" });
    await expectAppError(
      resolveStoreCompose(client, { repoId: SEL.repoId, appId: "Com.Example" }),
      "INPUT_INVALID",
    );
    expect(client.calls).toEqual([]);
  });

  it("rejects extra caller-controlled options with INPUT_INVALID and performs zero reads", async () => {
    const client = makeFakeClient({ repos: [], detail: {}, compose: "name: x" });
    await expectAppError(
      resolveStoreCompose(client, { ...SEL, force: true } as unknown as StoreSelection),
      "INPUT_INVALID",
    );
    expect(client.calls).toEqual([]);
  });

  it("rejects a missing/non-record selection with INPUT_INVALID and performs zero reads", async () => {
    const client = makeFakeClient({ repos: [], detail: {}, compose: "name: x" });
    for (const bad of [null, undefined, 42, "x", []]) {
      const fake = makeFakeClient({ repos: [] });
      await expectAppError(
        resolveStoreCompose(fake, bad as unknown as StoreSelection),
        "INPUT_INVALID",
      );
      expect(fake.calls).toEqual([]);
    }
    expect(client.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared synthetic fixtures
// ---------------------------------------------------------------------------

const repoEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "community",
  enabled: true,
  version: "v2",
  transport: "http",
  ...overrides,
});

const reposPayload = (): unknown[] => [
  repoEntry(),
  repoEntry({ id: "other", enabled: false, version: "v2", transport: "http" }),
];

const detailPayload = (arch: string, overrides: Record<string, unknown> = {}): unknown => {
  const path = `/apps/${SEL.appId}/docker-compose.${arch}.yml`;
  return {
    id: SEL.appId,
    repo_id: SEL.repoId,
    title: "Example Test App",
    version: "1.2.3",
    type: "compose",
    architectures: ["amd64", "arm64"],
    source: {
      compose_arch: arch,
      compose_path: path,
      compose_architectures: { [arch]: { path } },
    },
    ...overrides,
  };
};

const composeSource = (withRepoId = false): string =>
  [
    "name: example-test",
    "x-casaos:",
    `  id: ${SEL.appId}`,
    ...(withRepoId ? [`  repo_id: ${SEL.repoId}`] : []),
    "services:",
    "  main:",
    "    image: example/image:latest",
  ].join("\n");

const expectedDetail = (arch: string): StoreDetail => ({
  repoId: SEL.repoId,
  appId: SEL.appId,
  name: "Example Test App",
  version: "1.2.3",
  architecture: arch,
  composePath: `/apps/${SEL.appId}/docker-compose.${arch}.yml`,
});

// ---------------------------------------------------------------------------
// Happy paths: full resolution sequence
// ---------------------------------------------------------------------------

describe("resolveStoreCompose — happy resolution (amd64/arm64)", () => {
  it("resolves an amd64 item: one read per step, authoritative source adds repo_id", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "amd64",
      detail: detailPayload("amd64"),
      compose: composeSource(),
    });

    const result = await resolveStoreCompose(client, SEL);

    expect(client.calls).toEqual(["repos", "arch", "detail", "compose"]);
    expect(result.detail).toEqual(expectedDetail("amd64"));
    expect(result.name).toBe("example-test");
    expect(result.source).toContain("repo_id: community");
    for (const line of composeSource().split("\n")) {
      expect(result.source).toContain(line);
    }
  });

  it("resolves an arm64 item for the caller's current architecture", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "arm64",
      detail: detailPayload("arm64"),
      compose: composeSource(),
    });

    const result = await resolveStoreCompose(client, SEL);

    expect(client.calls).toEqual(["repos", "arch", "detail", "compose"]);
    expect(result.detail).toEqual(expectedDetail("arm64"));
    expect(result.detail.composePath).toBe(
      "/apps/com.example.test/docker-compose.arm64.yml",
    );
    expect(result.name).toBe("example-test");
    expect(result.source).toContain("repo_id: community");
  });

  it("returns the source byte-for-byte unchanged when the document is already associated", async () => {
    const source = composeSource(true);
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "amd64",
      detail: detailPayload("amd64"),
      compose: source,
    });

    const result = await resolveStoreCompose(client, SEL);

    expect(result.source).toBe(source);
    expect(result.name).toBe("example-test");
    expect(result.detail).toEqual(expectedDetail("amd64"));
  });
});

// ---------------------------------------------------------------------------
// Repository gate: unknown / disabled / malformed registry
// ---------------------------------------------------------------------------

describe("resolveStoreCompose — repository gate before architecture/detail/compose", () => {
  it("rejects an unknown repository with ZIMAOS_BAD_REQUEST and performs no further reads", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "amd64",
      detail: detailPayload("amd64"),
      compose: composeSource(),
    });

    await expectAppError(
      resolveStoreCompose(client, { repoId: "not-registered", appId: SEL.appId }),
      "ZIMAOS_BAD_REQUEST",
    );
    expect(client.calls).toEqual(["repos"]);
  });

  it("rejects a repository that is not enabled/v2/http with ZIMAOS_BAD_REQUEST and performs no further reads", async () => {
    for (const override of [
      { enabled: false, version: "v2", transport: "http" },
      { enabled: true, version: "v1", transport: "http" },
      { enabled: true, version: "v2", transport: "zip" },
    ]) {
      const client = makeFakeClient({
        repos: [repoEntry(override)],
        arch: "amd64",
        detail: detailPayload("amd64"),
        compose: composeSource(),
      });
      await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_BAD_REQUEST");
      expect(client.calls).toEqual(["repos"]);
    }
  });

  it("rejects a malformed registry with ZIMAOS_UPSTREAM_ERROR and performs no further reads", async () {
    for (const repos of [null, {}, "junk", [{ enabled: true }]]) {
      const client = makeFakeClient({
        repos,
        arch: "amd64",
        detail: detailPayload("amd64"),
        compose: composeSource(),
      });
      await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_UPSTREAM_ERROR");
      expect(client.calls).toEqual(["repos"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Detail gate: architecture, class, identity
// ---------------------------------------------------------------------------

describe("resolveStoreCompose — detail gate before Compose fetch", () => {
  it("rejects an unsupported current architecture with ZIMAOS_BAD_REQUEST and performs no Compose read", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "riscv64",
      detail: detailPayload("amd64"),
      compose: composeSource(),
    });

    await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_BAD_REQUEST");
    expect(client.calls).toEqual(["repos", "arch"]);
  });

  it("rejects a non-compose class with ZIMAOS_BAD_REQUEST and performs no Compose read", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "amd64",
      detail: detailPayload("amd64", { type: "zip" }),
      compose: composeSource(),
    });

    await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_BAD_REQUEST");
    expect(client.calls).toEqual(["repos", "arch", "detail"]);
  });

  it("rejects a detail whose id does not match the selection with ZIMAOS_UPSTREAM_ERROR and performs no Compose read", async () => {
    for (const overrides of [{ id: "com.other.app" }, { repo_id: "other" }]) {
      const client = makeFakeClient({
        repos: reposPayload(),
        arch: "amd64",
        detail: detailPayload("amd64", overrides),
        compose: composeSource(),
      });
      await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_UPSTREAM_ERROR");
      expect(client.calls).toEqual(["repos", "arch", "detail"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Compose gate: association failures and upstream propagation
// ---------------------------------------------------------------------------

describe("resolveStoreCompose — Compose association and upstream failures", () => {
  it("rejects a fetched Compose whose metadata does not match the selection with ZIMAOS_UPSTREAM_ERROR", async () => {
    const client = makeFakeClient({
      repos: reposPayload(),
      arch: "amd64",
      detail: detailPayload("amd64"),
      compose: composeSource().replace(`id: ${SEL.appId}`, "id: com.other.app"),
    });

    await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_UPSTREAM_ERROR");
    expect(client.calls).toEqual(["repos", "arch", "detail", "compose"]);
  });

  it("propagates a sanitized upstream AppError from a client read without wrapping it", async () => {
    for (const step of ["repos", "arch", "detail", "compose"] as const) {
      const failure = new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Upstream failure with secret-token-abc",
      );
      const client = makeFakeClient({
        repos: reposPayload(),
        arch: "amd64",
        detail: detailPayload("amd64"),
        compose: composeSource(),
        fail: { [step]: failure },
      });

      const err = await expectAppError(resolveStoreCompose(client, SEL), "ZIMAOS_UPSTREAM_ERROR");
      expect(err).toBe(failure);
      expect(err.message).not.toContain("secret-token");
    }
  });
});
