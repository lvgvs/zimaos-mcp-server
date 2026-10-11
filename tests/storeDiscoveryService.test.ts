/**
 * Focused synthetic tests for the bounded read-only store discovery service
 * (Phase 7 slice).
 *
 * The fake client implements EXACTLY the four readonly discovery reads plus
 * an ordered call record; all fixtures are synthetic (no VM, no secrets).
 * The pagination builder derives every field from (page, total) so no
 * brittle hardcoding of shapes is needed.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { AppService } from "../src/zimaos/appService.js";
import type { ZimaOsClient } from "../src/zimaos/client.js";
import type { StoreSelection } from "../src/zimaos/storeCatalog.js";
import type { StoreDiscoveryItem } from "../src/zimaos/storeDiscovery.js";
import {
  getAppStoreDetails,
  searchAppStore,
} from "../src/zimaos/storeDiscoveryService.js";

const QUERY = "bento";
const TRUSTED = ["alpha", "zimaos@v2"] as const;
const REPO_IDS = [...TRUSTED];

interface CallRecord {
  readonly name:
    | "getStoreRepositories"
    | "getStoreSearchPage"
    | "getStoreAppDetail"
    | "assertStoreDiscoverySafe";
  readonly args: readonly unknown[];
}

/**
 * Typed fake implementing exactly the four readonly discovery client
 * functions, with an ordered call record. No other client methods exist.
 */
class FakeDiscoveryClient {
  readonly calls: CallRecord[] = [];

  constructor(
    readonly repoPayload: unknown = repositoryListing(),
    public searchPages: Record<number, unknown> = {},
    public detailPayload: unknown = detailFixture(),
    private readonly guardReject:
      ((item: StoreDiscoveryItem) => boolean) | undefined = undefined,
  ) {}

  getStoreRepositories = async (): Promise<unknown> => {
    this.calls.push({ name: "getStoreRepositories", args: [] });
    return this.repoPayload;
  };

  getStoreSearchPage = async (
    query: string,
    repoIds: readonly string[],
    page: number,
  ): Promise<unknown> => {
    this.calls.push({ name: "getStoreSearchPage", args: [query, repoIds, page] });
    const value = this.searchPages[page];
    if (value === undefined) throw new AppError("INTERNAL", "unexpected search page");
    return value;
  };

  getStoreAppDetail = async (selection: StoreSelection): Promise<unknown> => {
    this.calls.push({ name: "getStoreAppDetail", args: [selection] });
    return this.detailPayload;
  };

  assertStoreDiscoverySafe = (item: StoreDiscoveryItem): void => {
    this.calls.push({ name: "assertStoreDiscoverySafe", args: [item] });
    if (this.guardReject !== undefined && this.guardReject(item)) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Store metadata could not be returned safely.",
      );
    }
  };

  asClient(): ZimaOsClient {
    return this as unknown as ZimaOsClient;
  }
}

/** Enabled v2 http repositories (order deliberately not bytewise). */
function repositoryListing(overrides: Record<string, unknown>[] = []): unknown {
  return [
    { id: "zimaos@v2", enabled: true, version: "v2", transport: "http" },
    { id: "alpha", enabled: true, version: "v2", transport: "http" },
    ...overrides,
  ];
}

function itemFixture(repoId: string, appId: string, extra: Record<string, unknown> = {}) {
  return { id: appId, repo_id: repoId, type: "compose", ...extra };
}

function detailFixture(overrides: Record<string, unknown> = {}) {
  return itemFixture("zimaos@v2", "com.example.app", {
    title: "Example App",
    ...overrides,
  });
}

/**
 * Pagination builder: derives page_size, total_pages, counts, echo and status
 * from (page, total, trusted repos) so tests never hardcode shapes.
 */
function envelopeFor(
  page: number,
  total: number,
  items: Record<string, unknown>[],
  options: {
    repoIds?: readonly string[];
    query?: string;
    locale?: string;
    types?: readonly string[];
    failed?: readonly string[];
    succeeded?: readonly string[];
    totalPages?: number;
    success?: unknown;
  } = {},
): Record<string, unknown> {
  const repoIds = options.repoIds ?? REPO_IDS;
  return {
    ...(options.success !== undefined ? { success: options.success } : {}),
    data: items,
    pagination: {
      page,
      page_size: 60,
      total,
      total_pages:
        options.totalPages ?? (total > 0 ? Math.max(1, Math.ceil(total / 60)) : 1),
    },
    query: {
      query: options.query ?? QUERY,
      repo_ids: [...repoIds],
      types: [...(options.types ?? ["compose"])],
      locale: options.locale ?? "en_US",
    },
    status: {
      repo: {
        failed: [...(options.failed ?? [])],
        succeeded: [...(options.succeeded ?? repoIds)],
      },
    },
  };
}

/** Unique, bytewise-sorted canonical app ids spread over the trusted repos. */
function canonicalAppId(index: number): string {
  return `com.example.app${String(index).padStart(3, "0")}`;
}

function makeItems(
  count: number,
  start: number,
  repoCycle: readonly string[] = REPO_IDS,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_value, offset) =>
    itemFixture(
      repoCycle[(start + offset) % repoCycle.length]!,
      canonicalAppId(start + offset),
    ),
  );
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

/** Envelope failures must never reflect fixture content. */
const NO_REFLECTION = ["com.example.app000", "SYNTHETIC"];

function assertNoReflection(
  err: AppError,
  forbidden: readonly string[] = NO_REFLECTION,
): void {
  for (const value of forbidden) expect(err.message).not.toContain(value);
}

describe("searchAppStore (synthetic client)", () => {
  it("validates the input BEFORE any reads (zero calls)", async () => {
    for (const input of [
      null,
      42,
      {},
      { limit: 5 },
      { query: QUERY, bogus: 1 },
      { query: "   " },
      { query: QUERY, limit: 0 },
      { query: QUERY, limit: 51 },
      { query: QUERY, limit: 2.5 },
    ]) {
      const fake = new FakeDiscoveryClient();
      const err = await expectAppError(searchAppStore(fake, input), "INPUT_INVALID");
      assertNoReflection(err);
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("returns an empty result without searching when no eligible repositories exist", async () => {
    for (const repoPayload of [
      [],
      [{ id: "v1", enabled: true, version: "v1", transport: "zip" }],
      [{ id: "off", enabled: false, version: "v2", transport: "http" }],
    ]) {
      const fake = new FakeDiscoveryClient(repoPayload);
      const result = await searchAppStore(fake, { query: QUERY });
      expect(result).toEqual({ apps: [], truncated: false });
      expect(fake.calls.map((call) => call.name)).toEqual(["getStoreRepositories"]);
    }
  });

  it("sends the trimmed query and the exact trusted bytewise repo set on page 1", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 1, [
      itemFixture("alpha", "com.example.app000", { title: "Bento" }),
    ]);

    const result = await searchAppStore(fake, { query: `  ${QUERY}  ` });

    const call = fake.calls.find((record) => record.name === "getStoreSearchPage");
    expect(call?.args).toEqual([QUERY, ["alpha", "zimaos@v2"], 1]);
    expect(result.apps).toEqual([
      { repo_id: "alpha", app_id: "com.example.app000", name: "Bento" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("normalizes every entry (allowlist only), sorts bytewise and drops optional metadata when absent", async () => {
    const items = [
      itemFixture("zimaos@v2", "com.example.app001", {
        title: "Second",
        update: "2026-01-01",
        source: "https://example.invalid/secret-needle",
        extra: "SYNTHETIC",
      }),
      itemFixture("alpha", "com.example.app000", {}),
    ];
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 2, items);

    const result = await searchAppStore(fake, { query: QUERY, limit: 50 });

    expect(result.apps).toEqual([
      { repo_id: "alpha", app_id: "com.example.app000" },
      { repo_id: "zimaos@v2", app_id: "com.example.app001", name: "Second" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("slices the deterministically sorted stream at limit and reports truncation", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 4, makeItems(4, 0, ["zimaos@v2", "alpha"]));

    const result = await searchAppStore(fake, { query: QUERY, limit: 2 });

    expect(result.apps).toHaveLength(2);
    expect(result.apps[0]).toMatchObject({ repo_id: "alpha" });
    expect(result.truncated).toBe(true);
    // Exactly one search page plus the repository listing: no hidden retries.
    expect(fake.calls.filter((call) => call.name === "getStoreSearchPage").length).toBe(
      1,
    );
  });

  it("fetches exactly five 60-row pages for total 301 / 6 pages and truncates", async () => {
    const fake = new FakeDiscoveryClient();
    for (let page = 1; page <= 5; page += 1) {
      fake.searchPages[page] = envelopeFor(
        page,
        301,
        makeItems(60, (page - 1) * 60, ["zimaos@v2", "alpha"]),
        { totalPages: 6 },
      );
    }

    const result = await searchAppStore(fake, { query: QUERY, limit: 50 });

    const searchCalls = fake.calls.filter((call) => call.name === "getStoreSearchPage");
    expect(searchCalls.length).toBe(5);
    expect(searchCalls.map((call) => call.args[2])).toEqual([1, 2, 3, 4, 5]);
    expect(result.apps).toHaveLength(50);
    expect(result.truncated).toBe(true);
    // Bytewise sort across repositories; duplicate app ids stay distinguishable by repo.
    expect(result.apps[0]?.repo_id).toBe("alpha");
    expect(result.apps[0]?.app_id).toBe("com.example.app001");
    const seen = new Set(result.apps.map((app) => `${app.repo_id}:${app.app_id}`));
    expect(seen.size).toBe(50);
  });

  it("rejects duplicate exact repo/app pairs within or across pages", async () => {
    for (const withinPage of [true, false]) {
      const duplicate = itemFixture("alpha", "com.example.dupe000");
      const pages: Record<number, unknown> = {};
      if (withinPage) {
        pages[1] = envelopeFor(1, 2, [
          duplicate,
          itemFixture("alpha", "com.example.dupe000"),
        ]);
      } else {
        pages[1] = envelopeFor(1, 61, [duplicate, ...makeItems(59, 0)], {
          totalPages: 2,
        });
        pages[2] = envelopeFor(2, 61, [itemFixture("alpha", "com.example.dupe000")], {
          totalPages: 2,
        });
      }
      const fake = new FakeDiscoveryClient();
      fake.searchPages = pages;
      const err = await expectAppError(
        searchAppStore(fake, { query: QUERY }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      assertNoReflection(err, ["com.example.dupe000"]);
      expect(
        fake.calls.filter((call) => call.name === "getStoreSearchPage"),
      ).toHaveLength(withinPage ? 1 : 2);
    }
  });

  it("rejects items whose repo_id is not in the trusted repository set", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 1, [itemFixture("rogue", "com.example.app000")]);
    const err = await expectAppError(
      searchAppStore(fake, { query: QUERY }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    assertNoReflection(err, ["rogue"]);
  });

  it("accepts reordered repository echo/status sets and preserves duplicate app IDs across repositories", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(
      1,
      2,
      [
        itemFixture("zimaos@v2", "com.example.same"),
        itemFixture("alpha", "com.example.same"),
      ],
      { repoIds: [...REPO_IDS].reverse(), succeeded: [...REPO_IDS].reverse() },
    );
    expect((await searchAppStore(fake, { query: QUERY })).apps).toEqual([
      { repo_id: "alpha", app_id: "com.example.same" },
      { repo_id: "zimaos@v2", app_id: "com.example.same" },
    ]);
  });

  it("fails with a normalized upstream error on missing query or positive repository status evidence", async () => {
    for (const field of ["query", "succeeded"]) {
      const fake = new FakeDiscoveryClient();
      const page = envelopeFor(1, 1, [itemFixture("alpha", "com.example.app000")]);
      if (field === "query") delete page.query;
      else page.status = { repo: { failed: [] } };
      fake.searchPages[1] = page;
      await expectAppError(
        searchAppStore(fake, { query: QUERY }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
    }
  });

  it("accepts a zero-total response without inventing a page count", async () => {
    for (const totalPages of [0, 1]) {
      const fake = new FakeDiscoveryClient();
      fake.searchPages[1] = envelopeFor(1, 0, [], { totalPages });
      expect(await searchAppStore(fake, { query: QUERY })).toEqual({
        apps: [],
        truncated: false,
      });
      expect(fake.calls.filter((c) => c.name === "getStoreSearchPage")).toHaveLength(1);
    }
  });

  it("rejects unsafe integer pagination counts", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, Number.MAX_SAFE_INTEGER + 1, makeItems(60, 0));
    await expectAppError(searchAppStore(fake, { query: QUERY }), "ZIMAOS_UPSTREAM_ERROR");
  });

  it("rejects malformed, partial or contradictory pagination evidence", async () => {
    const base = itemFixture("alpha", "com.example.app000");
    const cases: Array<[string, unknown]> = [
      ["non-record envelope", "SYNTHETIC"],
      ["explicit failure", { success: false, message: "SYNTHETIC" }],
      [
        "missing data",
        {
          success: true,
          pagination: { page: 1, page_size: 60, total: 1, total_pages: 1 },
          query: {
            query: QUERY,
            repo_ids: REPO_IDS,
            types: ["compose"],
            locale: "en_US",
          },
          status: { repo: { failed: [], succeeded: REPO_IDS } },
        },
      ],
      ["data longer than one page", envelopeFor(1, 61, makeItems(61, 0))],
      ["wrong page echo", envelopeFor(2, 1, [base]) as unknown],
      [
        "wrong page_size",
        {
          ...envelopeFor(1, 1, [base]),
          pagination: { page: 1, page_size: 30, total: 1, total_pages: 1 },
        },
      ],
      ["negative total", envelopeFor(1, -1, []) as unknown],
      [
        "total_pages below ceil(total/60)",
        envelopeFor(1, 121, makeItems(60, 0), { totalPages: 2 }),
      ],
      ["count exceeds remaining total", { ...envelopeFor(1, 5, makeItems(6, 0)) }],
      [
        "expected count mismatch",
        { ...envelopeFor(1, 70, makeItems(59, 0), { totalPages: 2 }) },
      ],
      ["zero total with rows", { ...envelopeFor(1, 0, [base]) }],
      ["zero total with wrong page", envelopeFor(2, 0, []) as unknown],
    ];
    for (const [name, envelope] of cases) {
      const fake = new FakeDiscoveryClient();
      fake.searchPages[1] = envelope;
      const err = await expectAppError(
        searchAppStore(fake, { query: QUERY }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      assertNoReflection(err);
      // No second attempt: a failed page never retried.
      expect(
        fake.calls.filter((call) => call.name === "getStoreSearchPage"),
      ).toHaveLength(1);
      void name;
    }
  });

  it("rejects a query echo that is not the requested trimmed text, locale or types", async () => {
    const base = itemFixture("alpha", "com.example.app000");
    for (const options of [
      { query: "other" },
      { locale: "tr_TR" },
      { types: ["compose", "zip"] },
      { types: [] },
      { repoIds: ["alpha"] },
      { repoIds: ["alpha", "rogue"] },
      { repoIds: ["alpha", "alpha"] },
    ]) {
      const fake = new FakeDiscoveryClient();
      fake.searchPages[1] = envelopeFor(1, 1, [base], options);
      const err = await expectAppError(
        searchAppStore(fake, { query: QUERY }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      assertNoReflection(err);
    }
  });

  it("rejects repository status with failed entries or a succeeded set that is not the trusted set", async () => {
    const base = itemFixture("alpha", "com.example.app000");
    for (const options of [
      { failed: ["alpha"] },
      { succeeded: ["alpha"] },
      { succeeded: ["alpha", "rogue"] },
    ]) {
      const fake = new FakeDiscoveryClient();
      fake.searchPages[1] = envelopeFor(1, 1, [base], options);
      const err = await expectAppError(
        searchAppStore(fake, { query: QUERY }),
        "ZIMAOS_UPSTREAM_ERROR",
      );
      assertNoReflection(err);
    }
  });

  it("fails closed when the pagination total snapshot changes across pages", async () => {
    const pages: Record<number, unknown> = {};
    for (let page = 1; page <= 2; page += 1) {
      pages[page] = envelopeFor(
        page,
        page === 1 ? 120 : 119,
        makeItems(60, (page - 1) * 60),
        { totalPages: 2 },
      );
    }
    const fake = new FakeDiscoveryClient();
    fake.searchPages = pages;
    const err = await expectAppError(
      searchAppStore(fake, { query: QUERY }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    assertNoReflection(err);
  });

  it("rejects a zero-total first page carrying rows or a missing pagination record", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = {
      data: [],
      query: { query: QUERY, repo_ids: REPO_IDS, types: ["compose"], locale: "en_US" },
      status: { repo: { failed: [], succeeded: REPO_IDS } },
    };
    const err = await expectAppError(
      searchAppStore(fake, { query: QUERY }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    assertNoReflection(err);
  });

  it("applies the no-I/O metadata guard to every normalized record and fails closed on it", async () => {
    const fake = new FakeDiscoveryClient(repositoryListing(), {}, undefined, (item) =>
      JSON.stringify(item).includes("password: x"),
    );
    fake.searchPages[1] = envelopeFor(1, 2, [
      itemFixture("alpha", "com.example.app000", { title: "safe name" }),
      itemFixture("zimaos@v2", "com.example.app001", { title: "password: x" }),
    ]);
    const err = await expectAppError(
      searchAppStore(fake, { query: QUERY }),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    assertNoReflection(err, ["password: x"]);
    expect(
      fake.calls.filter((call) => call.name === "assertStoreDiscoverySafe"),
    ).toHaveLength(2);
  });

  it("propagates the normalizer's fixed errors for malformed canonical or type evidence", async () => {
    for (const [fixture, code] of [
      [itemFixture("alpha", "com.example.app000", { id: 42 }), "ZIMAOS_UPSTREAM_ERROR"],
      [itemFixture("alpha", "com.example.app000", { type: "zip" }), "ZIMAOS_BAD_REQUEST"],
      [
        itemFixture("alpha", "com.example.app000", { title: 42 }),
        "ZIMAOS_UPSTREAM_ERROR",
      ],
    ] as const) {
      const fake = new FakeDiscoveryClient();
      fake.searchPages[1] = envelopeFor(1, 1, [fixture]);
      const err = await expectAppError(searchAppStore(fake, { query: QUERY }), code);
      assertNoReflection(err, ["42"]);
    }
  });

  it("makes exactly one repository listing read plus the fetched pages (no detail reads)", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 1, [itemFixture("alpha", "com.example.app000")]);
    await searchAppStore(fake, { query: QUERY });
    expect(fake.calls.map((call) => call.name)).toEqual([
      "getStoreRepositories",
      "getStoreSearchPage",
      "assertStoreDiscoverySafe",
    ]);
    expect(fake.calls.some((call) => call.name === "getStoreAppDetail")).toBe(false);
  });
});

describe("getAppStoreDetails (synthetic client)", () => {
  const SELECTION: StoreSelection = { repoId: "zimaos@v2", appId: "com.example.app" };

  it("validates the selection BEFORE any reads (zero calls)", async () => {
    for (const selection of [
      null,
      {},
      { repoId: "zimaos@v2" },
      { repoId: "zimaos@v2", appId: "nodots" },
      { repoId: "zimaos@v2", appId: "com.example.app", extra: 1 },
    ]) {
      const fake = new FakeDiscoveryClient();
      await expectAppError(
        getAppStoreDetails(fake, selection as StoreSelection),
        "INPUT_INVALID",
      );
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("rejects selections whose repository is missing, disabled or unsupported with zero detail reads", async () => {
    for (const [selection, repoPayload] of [
      [{ repoId: "rogue", appId: "com.example.app" }, repositoryListing()],
      [
        { repoId: "zimaos@v2", appId: "com.example.app" },
        [{ id: "zimaos@v2", enabled: false, version: "v2", transport: "http" }],
      ],
      [
        { repoId: "zimaos@v2", appId: "com.example.app" },
        [
          { id: "alpha", enabled: true, version: "v2", transport: "http" },
          { id: "zimaos@v2", enabled: true, version: "v1", transport: "zip" },
        ],
      ],
    ] as const) {
      const fake = new FakeDiscoveryClient(repoPayload);
      const err = await expectAppError(
        getAppStoreDetails(fake, selection),
        "ZIMAOS_BAD_REQUEST",
      );
      assertNoReflection(err, ["rogue"]);
      expect(fake.calls.map((call) => call.name)).toEqual(["getStoreRepositories"]);
    }
  });

  it("fails closed on a malformed repository listing before any detail read", async () => {
    const fake = new FakeDiscoveryClient(["not-a-record"]);
    await expectAppError(getAppStoreDetails(fake, SELECTION), "ZIMAOS_UPSTREAM_ERROR");
    expect(fake.calls.map((call) => call.name)).toEqual(["getStoreRepositories"]);
  });

  it("normalizes the exact detail, applies the guard, and reads only repo listing then detail", async () => {
    const fake = new FakeDiscoveryClient();
    fake.detailPayload = detailFixture({
      title: "Example App",
      architectures: ["amd64", "arm64"],
    });

    const detail = await getAppStoreDetails(fake, SELECTION);

    expect(detail).toEqual({
      repo_id: "zimaos@v2",
      app_id: "com.example.app",
      name: "Example App",
      architectures: ["amd64", "arm64"],
    });
    expect(fake.calls.map((call) => call.name)).toEqual([
      "getStoreRepositories",
      "getStoreAppDetail",
      "assertStoreDiscoverySafe",
    ]);
    expect(fake.calls[1]?.args).toEqual([SELECTION]);
  });

  it("rejects detail payloads whose identity does not match the selection or whose type is unsupported", async () => {
    for (const [overrides, code] of [
      [{ id: "com.example.other" }, "ZIMAOS_UPSTREAM_ERROR"],
      [{ repo_id: "alpha" }, "ZIMAOS_UPSTREAM_ERROR"],
      [{ type: "zip" }, "ZIMAOS_BAD_REQUEST"],
      [undefined, "ZIMAOS_UPSTREAM_ERROR"],
    ] as const) {
      const fake = new FakeDiscoveryClient();
      fake.detailPayload =
        overrides === undefined
          ? undefined
          : itemFixture("zimaos@v2", "com.example.app", overrides);
      const err = await expectAppError(getAppStoreDetails(fake, SELECTION), code);
      assertNoReflection(err, ["com.example.other", "alpha"]);
    }
  });

  it("applies the no-I/O metadata guard to the detail and fails closed on it", async () => {
    const fake = new FakeDiscoveryClient(
      repositoryListing(),
      {},
      detailFixture({ tagline: "password: x" }),
      (item) => JSON.stringify(item).includes("password: x"),
    );
    const err = await expectAppError(
      getAppStoreDetails(fake, SELECTION),
      "ZIMAOS_UPSTREAM_ERROR",
    );
    assertNoReflection(err, ["password: x"]);
    expect(
      fake.calls.filter((call) => call.name === "assertStoreDiscoverySafe"),
    ).toHaveLength(1);
  });
});

describe("AppService forwarding (synthetic client)", () => {
  it("forwards searchAppStore(input) to the shared helper", async () => {
    const fake = new FakeDiscoveryClient();
    fake.searchPages[1] = envelopeFor(1, 1, [itemFixture("alpha", "com.example.app000")]);
    const service = new AppService(fake.asClient());
    const result = await service.searchAppStore({ query: QUERY });
    expect(result.truncated).toBe(false);
    expect(fake.calls.some((call) => call.name === "getStoreSearchPage")).toBe(true);
  });

  it("forwards getAppStoreDetails(selection) to the shared helper", async () => {
    const fake = new FakeDiscoveryClient();
    const service = new AppService(fake.asClient());
    const detail = await service.getAppStoreDetails({
      repoId: "zimaos@v2",
      appId: "com.example.app",
    });
    expect(detail.app_id).toBe("com.example.app");
    expect(fake.calls.map((call) => call.name)).toContain("getStoreAppDetail");
  });
});
