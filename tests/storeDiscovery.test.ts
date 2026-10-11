/**
 * Focused tests for the pure store discovery normalization/input module.
 *
 * All fixtures are synthetic; the module under test is pure (no network,
 * no services, no secrets, no VM).
 */
import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import {
  normalizeStoreDiscoveryItem,
  validateStoreSearchInput,
} from "../src/zimaos/storeDiscovery.js";
import type { StoreSelection } from "../src/zimaos/storeCatalog.js";

const SEL: StoreSelection = { repoId: "community", appId: "com.example.test" };

/** Run fn, capture the thrown error, and return it. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected fn to throw, but it did not");
}

function expectCode(
  fn: () => unknown,
  code: string,
  forbidden: string[] = ["com.example.test", "community"],
): void {
  const err = capture(fn);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  // No reflection of input in messages.
  for (const value of forbidden) {
    expect((err as AppError).message).not.toContain(value);
  }
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "com.example.test",
    repo_id: "community",
    type: "compose",
    title: "Test App",
    version: "1.2.3",
    tagline: "A test tagline",
    category: "media",
    architectures: ["arm64", "amd64"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeStoreDiscoveryItem — summary
// ---------------------------------------------------------------------------
describe("normalizeStoreDiscoveryItem (summary)", () => {
  it("normalizes known display fields into a snake_case summary", () => {
    expect(normalizeStoreDiscoveryItem(item(), SEL, false)).toEqual({
      repo_id: "community",
      app_id: "com.example.test",
      name: "Test App",
      version: "1.2.3",
      tagline: "A test tagline",
      category: "media",
      architectures: ["amd64", "arm64"],
    });
  });

  it("omits absent/null/empty display fields", () => {
    expect(
      normalizeStoreDiscoveryItem(
        item({
          title: null,
          version: "",
          category: undefined,
          architectures: null,
        }),
        SEL,
        false,
      ),
    ).toEqual({
      repo_id: "community",
      app_id: "com.example.test",
      tagline: "A test tagline",
    });
  });

  it("rejects oversized display fields with a fixed upstream error", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ title: "x".repeat(121) }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ version: "x".repeat(81) }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ tagline: "x".repeat(513) }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ category: "x".repeat(129) }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("accepts display fields exactly at their maximum length", () => {
    const result = normalizeStoreDiscoveryItem(
      item({
        title: "x".repeat(120),
        version: "x".repeat(80),
        tagline: "x".repeat(512),
        category: "x".repeat(128),
      }),
      SEL,
      false,
    );
    expect(result.name).toHaveLength(120);
    expect(result.version).toHaveLength(80);
    expect(result.tagline).toHaveLength(512);
    expect(result.category).toHaveLength(128);
  });

  it("rejects wrong-typed display fields with a fixed upstream error", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ title: 42 }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ version: { v: 1 } }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ tagline: [1] }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ category: true }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("does not leak fields outside the allowlist", () => {
    const result = normalizeStoreDiscoveryItem(
      item({
        source: { compose_path: "/apps/com.example.test/docker-compose.amd64.yml" },
        envs: { A: "b" },
        ports: ["8080:80"],
        volumes: ["/opt/data"],
        urls: ["https://example.com"],
        installed: true,
        update: { available: true },
      }),
      SEL,
      false,
    );
    expect(Object.keys(result).sort()).toEqual([
      "app_id",
      "architectures",
      "category",
      "name",
      "repo_id",
      "tagline",
      "version",
    ]);
  });

  it("requires the upstream identity to match the requested selection exactly", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ id: "com.example.other" }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ repo_id: "EvilRepo" }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ repo_id: null }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects a non-compose type with a sanitized bad request", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ type: "zip" }), SEL, false),
      "ZIMAOS_BAD_REQUEST",
    );
  });

  it("rejects non-record upstream payloads with a fixed upstream error", () => {
    for (const bad of [null, undefined, [], "x", 42]) {
      expectCode(
        () => normalizeStoreDiscoveryItem(bad, SEL, false),
        "ZIMAOS_UPSTREAM_ERROR",
        [],
      );
    }
  });

  it("accepts items without an expected selection (identity from the item)", () => {
    const result = normalizeStoreDiscoveryItem(
      item({ id: "io.other.app", repo_id: "archive" }),
      undefined,
      false,
    );
    expect(result.repo_id).toBe("archive");
    expect(result.app_id).toBe("io.other.app");
  });

  it("rejects noncanonical upstream identities even without an expected selection", () => {
    for (const changes of [
      { id: "not-canonical" },
      { id: "Com.Example.App" },
      { id: "com..app" },
      { repo_id: "https://untrusted.test" },
      { repo_id: "x".repeat(129) },
    ]) {
      expectCode(
        () => normalizeStoreDiscoveryItem(item(changes)),
        "ZIMAOS_UPSTREAM_ERROR",
      );
    }
  });

  it("requires explicit verified compose type evidence", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ type: undefined })),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects items without an expected selection when identity is missing/non-string", () => {
    const noId = item();
    delete noId.id;
    expectCode(
      () => normalizeStoreDiscoveryItem(noId, undefined, false),
      "ZIMAOS_UPSTREAM_ERROR",
      [],
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ repo_id: 7 }), undefined, false),
      "ZIMAOS_UPSTREAM_ERROR",
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeStoreDiscoveryItem — details
// ---------------------------------------------------------------------------
describe("normalizeStoreDiscoveryItem (details)", () => {
  it("adds description/author/developer/release_notes when details is true", () => {
    expect(
      normalizeStoreDiscoveryItem(
        item({
          description: "Longer description text.",
          author: "alice",
          developer: "org-team",
          release_note: "Fixed a bug.",
        }),
        SEL,
        true,
      ),
    ).toEqual({
      repo_id: "community",
      app_id: "com.example.test",
      name: "Test App",
      version: "1.2.3",
      tagline: "A test tagline",
      category: "media",
      architectures: ["amd64", "arm64"],
      description: "Longer description text.",
      author: "alice",
      developer: "org-team",
      release_notes: "Fixed a bug.",
    });
  });

  it("omits detail fields when absent/null/empty", () => {
    const result = normalizeStoreDiscoveryItem(
      item({ description: null, author: "", developer: undefined, release_note: null }),
      SEL,
      true,
    );
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("author");
    expect(result).not.toHaveProperty("developer");
    expect(result).not.toHaveProperty("release_notes");
  });

  it("enforces detail field size limits with a fixed upstream error", () => {
    expectCode(
      () =>
        normalizeStoreDiscoveryItem(item({ description: "x".repeat(12001) }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ author: "x".repeat(257) }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ developer: "x".repeat(257) }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () =>
        normalizeStoreDiscoveryItem(item({ release_note: "x".repeat(8001) }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("accepts detail fields exactly at their maximum length", () => {
    const result = normalizeStoreDiscoveryItem(
      item({
        description: "x".repeat(12000),
        author: "x".repeat(256),
        developer: "x".repeat(256),
        release_note: "x".repeat(8000),
      }),
      SEL,
      true,
    );
    expect(result.description).toHaveLength(12000);
    expect(result.author).toHaveLength(256);
    expect(result.developer).toHaveLength(256);
    expect(result.release_notes).toHaveLength(8000);
  });

  it("rejects wrong-typed detail fields with a fixed upstream error", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ description: 1 }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ author: { a: 1 } }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ developer: [1] }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ release_note: false }), SEL, true),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeStoreDiscoveryItem — architectures
// ---------------------------------------------------------------------------
describe("normalizeStoreDiscoveryItem (architectures)", () => {
  it("sorts valid architecture labels bytewise", () => {
    const result = normalizeStoreDiscoveryItem(
      item({ architectures: ["zeta", "alpha", "m3"] }),
      SEL,
      false,
    );
    expect(result.architectures).toEqual(["alpha", "m3", "zeta"]);
  });

  it("accepts up to 8 labels of exactly 32 chars", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `arch_${i}_`.padEnd(32, "x"));
    const result = normalizeStoreDiscoveryItem(
      item({ architectures: labels }),
      SEL,
      false,
    );
    expect(result.architectures).toHaveLength(8);
    for (const label of result.architectures ?? []) {
      expect(label).toMatch(/^[a-z0-9_]+$/);
      expect(label.length).toBe(32);
    }
  });

  it("rejects more than 8 architecture labels", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `arch_${i}`);
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ architectures: nine }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects duplicate architecture labels", () => {
    expectCode(
      () =>
        normalizeStoreDiscoveryItem(
          item({ architectures: ["amd64", "amd64"] }),
          SEL,
          false,
        ),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });

  it("rejects malformed architecture labels", () => {
    for (const bad of [
      "AMD64", // uppercase
      "", // empty
      "amd.64", // dot
      "amd-64", // hyphen
      "a b", // space
      "x".repeat(33), // too long
      42, // non-string
      null, // null element
      { a: 1 }, // object element
    ]) {
      expectCode(
        () => normalizeStoreDiscoveryItem(item({ architectures: [bad] }), SEL, false),
        "ZIMAOS_UPSTREAM_ERROR",
      );
    }
  });

  it("rejects non-array architectures when present", () => {
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ architectures: "amd64" }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    expectCode(
      () => normalizeStoreDiscoveryItem(item({ architectures: {} }), SEL, false),
      "ZIMAOS_UPSTREAM_ERROR",
    );
  });
});

// ---------------------------------------------------------------------------
// validateStoreSearchInput
// ---------------------------------------------------------------------------
describe("validateStoreSearchInput", () => {
  it("returns the trimmed query and explicit limit", () => {
    expect(validateStoreSearchInput({ query: "  media center  ", limit: 10 })).toEqual({
      query: "media center",
      limit: 10,
    });
  });

  it("defaults limit to 20 when absent", () => {
    expect(validateStoreSearchInput({ query: "vaultwarden" })).toEqual({
      query: "vaultwarden",
      limit: 20,
    });
  });

  it("accepts limit boundaries 1 and 50", () => {
    expect(validateStoreSearchInput({ query: "a", limit: 1 }).limit).toBe(1);
    expect(validateStoreSearchInput({ query: "a", limit: 50 }).limit).toBe(50);
  });

  it("rejects missing, empty, whitespace-only, and oversized queries", () => {
    expectCode(() => validateStoreSearchInput({}), "INPUT_INVALID");
    expectCode(() => validateStoreSearchInput({ query: "" }), "INPUT_INVALID", []);
    expectCode(() => validateStoreSearchInput({ query: "   " }), "INPUT_INVALID", []);
    expectCode(
      () => validateStoreSearchInput({ query: "x".repeat(257) }),
      "INPUT_INVALID",
      [],
    );
  });

  it("accepts a query of exactly 256 code units", () => {
    const query = "x".repeat(256);
    expect(validateStoreSearchInput({ query }).query).toHaveLength(256);
  });

  it("rejects control characters U+0000..U+001F and DEL in the query", () => {
    for (const ch of ["\u0000", "\u0001", "\u000a", "\u001f", "\u007f"]) {
      expectCode(
        () => validateStoreSearchInput({ query: `a${ch}b` }),
        "INPUT_INVALID",
        [],
      );
    }
  });

  it("rejects non-string queries", () => {
    expectCode(() => validateStoreSearchInput({ query: 42 }), "INPUT_INVALID", []);
    expectCode(() => validateStoreSearchInput({ query: null }), "INPUT_INVALID", []);
    expectCode(() => validateStoreSearchInput({ query: ["a"] }), "INPUT_INVALID", []);
  });

  it("rejects out-of-range or non-integer limits", () => {
    for (const limit of [0, 51, 1.5, -1, "5", true, null, []]) {
      expectCode(
        () => validateStoreSearchInput({ query: "a", limit }),
        "INPUT_INVALID",
        [],
      );
    }
  });

  it("rejects unknown keys and non-record inputs", () => {
    expectCode(
      () => validateStoreSearchInput({ query: "a", page: 2 }),
      "INPUT_INVALID",
      [],
    );
    for (const bad of [null, undefined, [], "a", 42]) {
      expectCode(() => validateStoreSearchInput(bad), "INPUT_INVALID", []);
    }
  });

  it("never reflects the query in error messages", () => {
    const query = "needle-in-haystack-\u0007probe";
    const err = capture(() => validateStoreSearchInput({ query }));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).not.toContain("needle-in-haystack");
    expect((err as AppError).message).not.toContain("\u0007");
  });
});
