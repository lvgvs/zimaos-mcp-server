/**
 * Focused tests for the pure store catalog module (Phase 6 slice).
 *
 * All fixtures are synthetic; no real VM, candidate, or secret material is
 * referenced. No network: the module under test is pure.
 */
import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import {
  associateStoreCompose,
  assertStoreSelection,
  normalizeStoreDetail,
  normalizeStoreRepositories,
} from "../src/zimaos/storeCatalog.js";
import type { StoreSelection } from "../src/zimaos/storeCatalog.js";

const SEL: StoreSelection = {
  repoId: "community",
  appId: "com.example.test",
};

/** Run fn, capture the thrown error, and return it. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected fn to throw, but it did not");
}

function expectCode(fn: () => unknown, code: string): void {
  const err = capture(fn);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  // No reflection of input in messages.
  expect((err as AppError).message).not.toContain("com.example.test");
  expect((err as AppError).message).not.toContain("EvilRepo");
}

// ---------------------------------------------------------------------------
// normalizeStoreRepositories
// ---------------------------------------------------------------------------
describe("normalizeStoreRepositories", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: "community",
    enabled: true,
    version: "v2",
    transport: "http",
    ...overrides,
  });

  it("keeps only enabled v2 http entries and normalizes to {id}", () => {
    const data = [
      entry(),
      entry({ id: "archived", enabled: false }),
      entry({ id: "legacy", version: "v1" }),
      entry({ id: "zipper", version: "v2", transport: "zip" }),
      entry({ id: "https-only", version: "v2", transport: "https" }),
    ];
    expect(normalizeStoreRepositories(data)).toEqual([{ id: "community" }]);
  });

  it("returns an empty array for an empty unwrapped array", () => {
    expect(normalizeStoreRepositories([])).toEqual([]);
  });

  it("rejects a non-array payload", () => {
    for (const bad of [null, undefined, {}, "x", 42, "not-an-array"]) {
      expect(() => normalizeStoreRepositories(bad)).toThrow(AppError);
    }
    expectCode(
      () => normalizeStoreRepositories({ id: "community" }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects more than 128 entries", () => {
    const entries = Array.from({ length: 129 }, (_, i) => entry({ id: `repo${i}` }));
    expectCode(() => normalizeStoreRepositories(entries), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects a malformed entry (non-record or missing id)", () => {
    expect(() =>
      normalizeStoreRepositories([entry(), { enabled: true, version: "v2" }]),
    ).toThrow(AppError);
    expect(() => normalizeStoreRepositories([entry(), "junk"])).toThrow(AppError);
    expect(() => normalizeStoreRepositories([entry(), null])).toThrow(AppError);
    expectCode(
      () => normalizeStoreRepositories([{ enabled: true }]),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects invalid repository identifiers (URL/path/%/colon/query/leading symbol/too long)", () => {
    const badIds = [
      "",
      "repo with space",
      "a/b",
      "a%b",
      "a?b=1",
      "a:b",
      "https://x",
      "/abs/path",
      "a..",
      "a@b@c",
      "#anchor",
      "répo",
      "repo;rm",
      "repo|pipe",
      "-leading-dash",
      ".leading-dot",

      "a" + "b".repeat(128), // 129 chars
    ];
    for (const id of badIds) {
      expect(
        () => normalizeStoreRepositories([entry({ id })]),
        `id ${JSON.stringify(id)}`,
      ).toThrow(AppError);
    }
    expectCode(
      () => normalizeStoreRepositories([entry({ id: "a/b" })]),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("accepts the full allowed identifier character set and max length 128", () => {
    const ok = ["community", "Repo_A", "a.b", "a_b-c.d", "r@e", "a".repeat(128)];
    const repos = normalizeStoreRepositories(ok.map((id) => entry({ id })));
    expect(repos.map((r) => r.id)).toEqual(ok);
  });

  it("rejects ambiguous duplicate ids even when one entry is ignored", () => {
    expect(() =>
      normalizeStoreRepositories([entry(), entry({ id: "community", enabled: false })]),
    ).toThrow(AppError);
    expectCode(
      () => normalizeStoreRepositories([entry(), entry({ id: "COMMUNITY" })]),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });
});

// ---------------------------------------------------------------------------
// assertStoreSelection
// ---------------------------------------------------------------------------
describe("assertStoreSelection", () => {
  const sel = (repoId: string, appId: string) => ({ repoId, appId });

  it("rejects additional caller-controlled options", () => {
    for (const extra of [
      { repoUrl: "https://example.test" },
      { uncontrolled: true },
      { force: true },
    ]) {
      expectCode(() => assertStoreSelection({ ...SEL, ...extra }), "INPUT_INVALID");
    }
  });

  it("accepts a canonical selection", () => {
    expect(assertStoreSelection(SEL)).toBeUndefined();
    expect(assertStoreSelection(sel("Repo_A", "org.example.tool_v2"))).toBeUndefined();
  });

  it("rejects empty or unsafe repository ids (fixed INPUT_INVALID)", () => {
    for (const repoId of [
      "",
      "a/b",
      "a%b",
      "a b",
      "a:b",
      "https://x",
      "a?b=1",
      ".lead",
      "x" + "y".repeat(128),
    ]) {
      expect(() => assertStoreSelection(sel(repoId, SEL.appId))).toThrow(AppError);
    }
    expectCode(() => assertStoreSelection(sel("a/b", SEL.appId)), "INPUT_INVALID");
  });

  it("rejects non-canonical app ids (uppercase, single segment, too long, unsafe chars)", () => {
    for (const appId of [
      "",
      "single", // single segment
      "com.Example.test", // uppercase
      "com..test", // empty segment
      ".com.test", // leading dot
      "com.test.", // trailing dot
      "com test.test", // whitespace
      "com/test.test", // path
      "com%test.test", // percent
      "com:80.test", // colon
      "com.test." + "a".repeat(185), // > 192
    ]) {
      expect(() => assertStoreSelection(sel("community", appId))).toThrow(AppError);
    }
    expectCode(
      () => assertStoreSelection(sel("community", "com.Example")),
      "INPUT_INVALID",
    );
  });

  it("accepts app ids at the 192-character boundary with allowed extras", () => {
    const prefix = "com.example.";
    const appId = `${prefix}${"a".repeat(192 - prefix.length - 2)}_x`;
    expect(appId.length).toBe(192);
    expect(assertStoreSelection(sel("community", appId))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeStoreDetail
// ---------------------------------------------------------------------------
describe("normalizeStoreDetail", () => {
  const detail = (arch: string, overrides: Record<string, unknown> = {}) => ({
    id: SEL.appId,
    repo_id: SEL.repoId,
    title: "Example Test App",
    version: "1.2.3",
    type: "compose",
    architectures: ["amd64", "arm64"],
    source: {
      compose_arch: arch,
      compose_path: `/apps/${SEL.appId}/docker-compose.${arch}.yml`,
      compose_architectures: {
        amd64: {
          path: `/apps/${SEL.appId}/docker-compose.amd64.yml`,
          url: `https://files.example.test/ExampleTest/amd64/docker-compose.amd64.yml`,
        },
        arm64: {
          path: `/apps/${SEL.appId}/docker-compose.arm64.yml`,
          url: `https://files.example.test/ExampleTest/arm64/docker-compose.arm64.yml`,
        },
        universal: {
          path: `/apps/${SEL.appId}/docker-compose.yml`,
        },
      },
    },
    ...overrides,
  });

  it("normalizes an amd64 detail (selected arch == advertised arch)", () => {
    const out = normalizeStoreDetail(detail("amd64"), SEL, "amd64");
    expect(out).toEqual({
      repoId: "community",
      appId: "com.example.test",
      name: "Example Test App",
      version: "1.2.3",
      architecture: "amd64",
      composePath: "/apps/com.example.test/docker-compose.amd64.yml",
    });
  });

  it("normalizes an arm64 detail", () => {
    const out = normalizeStoreDetail(detail("arm64"), SEL, "arm64");
    expect(out.architecture).toBe("arm64");
    expect(out.composePath).toBe("/apps/com.example.test/docker-compose.arm64.yml");
  });

  it("omits optional name/version when absent", () => {
    const d = detail("amd64", {});
    delete (d as Record<string, unknown>).title;
    delete (d as Record<string, unknown>).version;
    const out = normalizeStoreDetail(d, SEL, "amd64");
    expect(out).not.toHaveProperty("name");
    expect(out).not.toHaveProperty("version");
  });

  it("rejects detail id or repo_id that do not match the selection (upstream)", () => {
    expectCode(
      () => normalizeStoreDetail(detail("amd64", { id: "com.other.app" }), SEL, "amd64"),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDetail(detail("amd64", { repo_id: "other" }), SEL, "amd64"),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects unsupported type (zip/version 1/missing) as ZIMAOS_BAD_REQUEST", () => {
    for (const type of ["zip", "v1", "1", undefined]) {
      expect(() => normalizeStoreDetail(detail("amd64", { type }), SEL, "amd64")).toThrow(
        AppError,
      );
    }
    expectCode(
      () => normalizeStoreDetail(detail("amd64", { type: "zip" }), SEL, "amd64"),
      "ZIMAOS_BAD_REQUEST",
    );
  });

  it("rejects an unsupported current architecture (fixed BAD_REQUEST)", () => {
    expectCode(
      () => normalizeStoreDetail(detail("amd64"), SEL, "riscv64"),
      "ZIMAOS_BAD_REQUEST",
    );
    expectCode(
      () => normalizeStoreDetail(detail("amd64"), SEL, "amd64 "),
      "ZIMAOS_BAD_REQUEST",
    );
  });

  it("rejects a current architecture not advertised by the detail", () => {
    const d = detail("amd64", { architectures: ["amd64"] });
    expectCode(() => normalizeStoreDetail(d, SEL, "arm64"), "ZIMAOS_BAD_REQUEST");
  });

  it("rejects unsane architectures arrays (>8, duplicate, non-string, non-array)", () => {
    expect(() =>
      normalizeStoreDetail(
        detail("amd64", {
          architectures: Array.from({ length: 9 }, (_, i) => `arch${i}`),
        }),
        SEL,
        "amd64",
      ),
    ).toThrow(AppError);
    expect(() =>
      normalizeStoreDetail(
        detail("amd64", { architectures: ["amd64", "amd64"] }),
        SEL,
        "amd64",
      ),
    ).toThrow(AppError);
    expect(() =>
      normalizeStoreDetail(detail("amd64", { architectures: [true] }), SEL, "amd64"),
    ).toThrow(AppError);
    expect(() =>
      normalizeStoreDetail(detail("amd64", { architectures: "amd64" }), SEL, "amd64"),
    ).toThrow(AppError);
    expectCode(
      () =>
        normalizeStoreDetail(
          detail("amd64", { architectures: ["amd64", "amd64"] }),
          SEL,
          "amd64",
        ),
      "ZIMAOS_BAD_REQUEST",
    );
  });

  it("rejects server-selected compose_arch that is universal/default/generic (fail closed)", () => {
    for (const arch of ["universal", "default", "", null]) {
      expect(() => normalizeStoreDetail(detail(arch as string), SEL, "amd64")).toThrow(
        AppError,
      );
    }
    expectCode(
      () => normalizeStoreDetail(detail("universal"), SEL, "amd64"),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects compose_arch different from the requested current arch (no fallback)", () => {
    const d = detail("arm64");
    expectCode(() => normalizeStoreDetail(d, SEL, "amd64"), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects compose_path traversal, external, or non-canonical paths (upstream)", () => {
    const badPaths = [
      "/apps/../etc/passwd",
      `/apps/${SEL.appId}/docker-compose.yml`,
      `/apps/${SEL.appId}/other.amd64.yml`,
      `/apps/other-app/docker-compose.amd64.yml`,
      "/apps/com.example.test/docker-compose.amd64.yml?x=1",
      "apps/com.example.test/docker-compose.amd64.yml",
      "/opt/apps/docker-compose.amd64.yml",
    ];
    for (const compose_path of badPaths) {
      const d = detail("amd64", {
        source: {
          compose_arch: "amd64",
          compose_path,
          compose_architectures: {
            amd64: { path: compose_path },
          },
        },
      });
      expect(() => normalizeStoreDetail(d, SEL, "amd64"), `path ${compose_path}`).toThrow(
        AppError,
      );
    }
    expectCode(
      () =>
        normalizeStoreDetail(
          detail("amd64", {
            source: {
              compose_arch: "amd64",
              compose_path: "/apps/../etc/passwd",
              compose_architectures: { amd64: { path: "/apps/../etc/passwd" } },
            },
          }),
          SEL,
          "amd64",
        ),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects compose_path when it does not match compose_architectures[arch].path", () => {
    const d = detail("amd64", {
      source: {
        compose_arch: "amd64",
        compose_path: `/apps/${SEL.appId}/docker-compose.amd64.yml`,
        compose_architectures: {
          amd64: { path: `/apps/${SEL.appId}/docker-compose.different.yml` },
        },
      },
    });
    expectCode(() => normalizeStoreDetail(d, SEL, "amd64"), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects malformed/mismatched detail shape (upstream, no reflection)", () => {
    expect(() => normalizeStoreDetail(null, SEL, "amd64")).toThrow(AppError);
    expect(() =>
      normalizeStoreDetail({ id: SEL.appId, repo_id: SEL.repoId }, SEL, "amd64"),
    ).toThrow(AppError); // missing type/architectures/source
    const badTitle = detail("amd64", { title: "t".repeat(121) });
    expect(() => normalizeStoreDetail(badTitle, SEL, "amd64")).toThrow(AppError);
    const badVersion = detail("amd64", { version: 42 });
    expect(() => normalizeStoreDetail(badVersion, SEL, "amd64")).toThrow(AppError);
    expectCode(() => normalizeStoreDetail(null, SEL, "amd64"), "ZIMAOS_UPSTREAM_ERROR");
    expectCode(
      () => normalizeStoreDetail(badTitle, SEL, "amd64"),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects a remote URL in place of the path field", () => {
    const d = detail("amd64", {
      source: {
        compose_arch: "amd64",
        compose_path:
          "https://files.example.test/ExampleTest/amd64/docker-compose.amd64.yml",
        compose_architectures: {
          amd64: {
            path: "https://files.example.test/ExampleTest/amd64/docker-compose.amd64.yml",
          },
        },
      },
    });
    expectCode(() => normalizeStoreDetail(d, SEL, "amd64"), "ZIMAOS_UPSTREAM_ERROR");
  });
});

// ---------------------------------------------------------------------------
// associateStoreCompose
// ---------------------------------------------------------------------------
describe("associateStoreCompose", () => {
  it("rejects an anchored association map reused by another part of the document", () => {
    const source = [
      "name: example-test",
      "x-casaos: &metadata",
      `  id: ${SEL.appId}`,
      "x-other: *metadata",
      "services:",
      "  main:",
      "    image: example/image:latest",
    ].join("\n");
    expectCode(() => associateStoreCompose(source, SEL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("validates association selection before modifying the document", () => {
    expectCode(
      () =>
        associateStoreCompose("name: invalid", {
          repoId: "https://example.test",
          appId: SEL.appId,
        }),
      "INPUT_INVALID",
    );
  });
  const base = [
    "name: example-test",
    "x-casaos:",
    "  id: com.example.test",
    "services:",
    "  web:",
    "    image: registry.example.test/example:test",
    "    environment:",
    "      SECRET_TOKEN: hunter2",
    "    ports:",
    "      - '8080:80'",
  ].join("\n");

  it("preserves source bytes exactly when x-casaos.repo_id already matches", () => {
    const withRepo = [
      "name: example-test",
      "x-casaos:",
      "  id: com.example.test",
      "  repo_id: community",
      "services:",
      "  web:",
      "    image: registry.example.test/example:test",
    ].join("\n");
    const out = associateStoreCompose(withRepo, SEL);
    expect(out.name).toBe("example-test");
    expect(out.source).toBe(withRepo);
  });

  it("adds a deterministic repo association when repo_id is absent", () => {
    const out = associateStoreCompose(base, SEL);
    expect(out.name).toBe("example-test");
    expect(out.source).toContain("repo_id: community");
    // The original lines are all preserved; only one field is added.
    for (const line of base.split("\n")) {
      expect(out.source).toContain(line);
    }
    // Services, image, env, ports untouched.
    expect(out.source).toContain("image: registry.example.test/example:test");
    expect(out.source).toContain("SECRET_TOKEN: hunter2");
    expect(out.source).toContain("- '8080:80'");
  });

  it("returns an authoritative final source that reparses with verified identity", () => {
    const out = associateStoreCompose(base, SEL);
    // The final source must contain exactly one associated identity field
    // each, plus the original name.
    const lines = out.source.split("\n");
    expect(lines.filter((l) => l.trim() === "repo_id: community")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "id: com.example.test")).toHaveLength(1);
    expect(out.source).toContain("name: example-test");
  });

  it("fails when x-casaos.repo_id is present but mismatched or non-string", () => {
    const mismatched = base.replace(
      "  id: com.example.test",
      "  id: com.example.test\n  repo_id: other-repo",
    );
    expectCode(() => associateStoreCompose(mismatched, SEL), "ZIMAOS_UPSTREAM_ERROR");

    const nonString = base.replace(
      "  id: com.example.test",
      "  id: com.example.test\n  repo_id: 42",
    );
    expectCode(() => associateStoreCompose(nonString, SEL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("fails when x-casaos.id is missing or not the canonical selection id", () => {
    const missingId = base.replace("  id: com.example.test\n", "");
    expectCode(() => associateStoreCompose(missingId, SEL), "ZIMAOS_UPSTREAM_ERROR");

    const wrongId = base.replace("  id: com.example.test", "  id: com.other.app");
    expectCode(() => associateStoreCompose(wrongId, SEL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("fails when x-casaos is absent, aliased, or merge-built (fail closed)", () => {
    const noCasaos = [
      "name: example-test",
      "services:",
      "  web:",
      "    image: registry.example.test/example:test",
    ].join("\n");
    expectCode(() => associateStoreCompose(noCasaos, SEL), "ZIMAOS_UPSTREAM_ERROR");

    const aliased = [
      "name: example-test",
      "casasos-template: &casasos-template",
      "  id: com.example.test",
      "x-casaos: *casasos-template",
      "services:",
      "  web:",
      "    image: registry.example.test/example:test",
    ].join("\n");
    expectCode(() => associateStoreCompose(aliased, SEL), "ZIMAOS_UPSTREAM_ERROR");

    const merged = [
      "name: example-test",
      "casasos-template: &casasos-template",
      "  id: com.example.test",
      "x-casaos:",
      "  <<: *casasos-template",
      "services:",
      "  web:",
      "    image: registry.example.test/example:test",
    ].join("\n");
    expectCode(() => associateStoreCompose(merged, SEL), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("fails when the compose name is missing/unsafe (INPUT_INVALID via identity)", () => {
    const unnamed = base.replace("name: example-test\n", "");
    expectCode(() => associateStoreCompose(unnamed, SEL), "INPUT_INVALID");

    const unsafeName = base.replace("name: example-test", "name: Example Test!");
    expectCode(() => associateStoreCompose(unsafeName, SEL), "INPUT_INVALID");
  });

  it("fails on unparseable / over-budget compose sources (fixed, no raw YAML)", () => {
    const syntaxError = ["name: example-test", "  bad-indent: [", "x: y"].join("\n");
    const e1 = capture(() => associateStoreCompose(syntaxError, SEL));
    expect(e1).toBeInstanceOf(AppError);
    expect((e1 as AppError).code).toBe("ZIMAOS_UPSTREAM_ERROR");
    expect((e1 as AppError).message).not.toContain("bad-indent");

    const tooBig = "name: example-test\n" + "# pad\n".repeat(100_000);
    const e2 = capture(() => associateStoreCompose(tooBig, SEL));
    expect(e2).toBeInstanceOf(AppError);
    expect((e2 as AppError).code).toBe("ZIMAOS_UPSTREAM_ERROR");
    expect((e2 as AppError).message).not.toContain("# pad");
  });

  it("never reflects secrets or URL fragments in error messages", () => {
    const withSecret = [
      "name: example-test",
      "x-casaos:",
      "  id: com.other.app",
      "  repo_id: https://files.example.test/token=SECRET42",
      "services:",
      "  web:",
      "    image: registry.example.test/example:test",
    ].join("\n");
    const e = capture(() => associateStoreCompose(withSecret, SEL));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("ZIMAOS_UPSTREAM_ERROR");
    expect((e as AppError).message).not.toContain("SECRET42");
    expect((e as AppError).message).not.toContain("files.example.test");
  });
});
