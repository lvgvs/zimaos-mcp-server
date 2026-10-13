import { describe, expect, it } from "vitest";
import {
  normalizeAppList,
  normalizeContainers,
  type AppInfo,
} from "../src/domain/models.js";

/**
 * Focused pure-normalizer contract tests for the app/container metadata
 * additions (localized store titles, optional `mainService`, optional
 * `isMainService`). Synthetic ids/payloads only; no live fixtures, no
 * upstream calls. New fields are asserted structurally (hasOwnProperty /
 * toMatchObject) so the suite is runnable before the interfaces gain them.
 */

/**
 * UTF-8 byte length of a fixture string, asserted against the normalizer's
 * 256-byte cap. 257 UTF-16 code units can never fit in 256 UTF-8 bytes
 * (byte count is at least code-unit count), so the cheap length pre-check
 * must reject such values before any TextEncoder allocation (see the
 * encoder-spy test below).
 */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function assertValidLocaleKeys(keys: string[]): void {
  const re = /^[a-z]{2}(?:[_-][A-Za-z0-9]{2,8})?$/;
  for (const key of keys) {
    expect(re.test(key)).toBe(true);
  }
}

const VALID_KEYS_30 = [
  "aa",
  "ab",
  "ac",
  "ad",
  "ae",
  "af",
  "ag",
  "ah",
  "ai",
  "aj",
  "ak",
  "al",
  "am",
  "an",
  "ao",
  "ap",
  "aq",
  "ar",
  "as",
  "at",
  "au",
  "av",
  "aw",
  "ax",
  "ay",
  "az",
  "ba",
  "bb",
  "bc",
  "bd",
];

function localizedTitleMap(extra: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of VALID_KEYS_30) map[key] = `Title ${key}`;
  return { ...map, ...extra };
}

function appPayload(id: string, store: Record<string, unknown>): unknown {
  return {
    [id]: {
      status: "running",
      update_available: false,
      is_uncontrolled: false,
      store_info: store,
    },
  };
}

describe("normalizeAppList: legacy plain-string title behavior (unchanged)", () => {
  it("keeps plain-string title, status and booleans unchanged", () => {
    const apps = normalizeAppList(appPayload("synth-legacy", { title: "Legacy Title" }));
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: "synth-legacy",
      name: "Legacy Title",
      status: "running",
      updateAvailable: false,
      isUncontrolled: false,
    });
    // No new metadata fields leak into the legacy shape.
    expect(Object.keys(apps[0]!).sort()).toEqual([
      "id",
      "isUncontrolled",
      "name",
      "status",
      "updateAvailable",
    ]);
  });
});

describe("normalizeAppList: localized store_info.title maps", () => {
  it("prefers en_us when present with a valid value", () => {
    const apps = normalizeAppList(
      appPayload("synth-localized", {
        title: {
          tr: "Sentetik Uygulama",
          de: "Synthese-Anwendung",
          en_us: "Synth Localized App",
          en: "Synth English",
        },
      }),
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: "synth-localized",
      name: "Synth Localized App",
    });
  });
});

describe("normalizeAppList: optional mainService from store_info.main", () => {
  it("reports valid store_info.main as mainService", () => {
    const apps = normalizeAppList(
      appPayload("synth-withmain", {
        title: "With Main App",
        main: "app-server",
      }),
    );
    expect(apps).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(apps[0], "mainService")).toBe(true);
    expect(apps[0]).toMatchObject({ mainService: "app-server" });
  });

  it("omits mainService when store_info.main is missing", () => {
    const apps = normalizeAppList(appPayload("synth-nomain", { title: "No Main App" }));
    expect(apps).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(apps[0], "mainService")).toBe(false);
  });
});

function containersPayload(main: unknown, containers: unknown): unknown {
  return { main, containers };
}

function containerRec(service: string, extra: Record<string, unknown> = {}) {
  return {
    ID: `id-${service}`,
    Name: `name-${service}`,
    Image: `registry.example/test/${service}:latest`,
    Service: service,
    ...extra,
  };
}

describe("normalizeAppList: localized title negative cases", () => {
  const names = (store: Record<string, unknown>) =>
    normalizeAppList(appPayload("synth-app", store)).map((a) => a.name);

  it("falls back to id for empty string, null, array, number and object-with-no-valid-keys titles", () => {
    expect(names({ title: "" })).toEqual(["synth-app"]);
    expect(names({ title: null })).toEqual(["synth-app"]);
    expect(names({ title: ["en", "Some App"] })).toEqual(["synth-app"]);
    expect(names({ title: 42 })).toEqual(["synth-app"]);
    expect(names({ title: { de: 7, en: null } })).toEqual(["synth-app"]);
  });

  it("ignores invalid locale keys and prototype-inherited values", () => {
    expect(
      names({ title: { english: "Nope", "en-us-x": "Nope", en: "English Ok" } }),
    ).toEqual(["English Ok"]);
    const proto = Object.create(null);
    proto["en"] = "From Prototype";
    const own = Object.create(proto);
    own["de"] = "Eigene Sprache";
    expect(names({ title: own })).toEqual(["Eigene Sprache"]);
  });

  it("accepts a 32-key map with valid locale keys and prefers the valid en_us value", () => {
    const keys = [...VALID_KEYS_30, "en_us", "en"];
    expect(new Set(keys).size).toBe(32);
    assertValidLocaleKeys(keys);
    const map = localizedTitleMap({ en_us: "Synth Boundary", en: "Synth English" });
    expect(Object.keys(map)).toHaveLength(32);
    expect(names({ title: map })).toEqual(["Synth Boundary"]);
  });

  it("falls back to id for a 33-key map whose keys are all valid locale keys", () => {
    const keys = [...VALID_KEYS_30, "be", "en_us", "en"];
    expect(new Set(keys).size).toBe(33);
    assertValidLocaleKeys(keys);
    const map = localizedTitleMap({
      be: "Synth Be",
      en_us: "Synth Boundary",
      en: "Synth English",
    });
    expect(Object.keys(map)).toHaveLength(33);
    expect(names({ title: map })).toEqual(["synth-app"]);
  });

  it("rejects a 257 UTF-16 char value without allocating a UTF-8 encoder (cheap bound check first)", () => {
    // UTF-8 byte count is at least the UTF-16 code-unit count,
    // so the bound check must reject before any TextEncoder allocation.
    let encodeCalls = 0;
    const originalEncode = TextEncoder.prototype.encode;
    const spy = function (this: unknown, ...args: unknown[]) {
      encodeCalls += 1;
      return originalEncode.apply(this, args as [string]);
    } as typeof originalEncode;
    TextEncoder.prototype.encode = spy;
    try {
      expect(names({ title: { en: "a".repeat(257) } })).toEqual(["synth-app"]);
      expect(encodeCalls).toBe(0);
    } finally {
      TextEncoder.prototype.encode = originalEncode;
    }
  });

  it("skips whitespace-only and non-string values; picks the only valid candidate", () => {
    expect(names({ title: { en: "   ", fr: "Français" } })).toEqual(["Français"]);
    expect(names({ title: { en_us: "", en: "English" } })).toEqual(["English"]);
  });

  it("honors the 256 UTF-8 byte cap: 256 bytes valid, 258 bytes rejected (no truncation)", () => {
    // "ä" is 2 UTF-8 bytes: 128 chars = 256 bytes (valid), 129 chars = 258 (rejected).
    expect(utf8Bytes("ä".repeat(128))).toBe(256);
    expect(utf8Bytes("ä".repeat(129))).toBe(258);
    expect(names({ title: { en: "ä".repeat(128) } })).toEqual(["ä".repeat(128)]);
    expect(names({ title: { en: "ä".repeat(129) } })).toEqual(["synth-app"]);
    // A 256-byte title still loses to a smaller valid en_us candidate.
    expect(names({ title: { en_us: "Small", en: "ä".repeat(129) } })).toEqual(["Small"]);
  });

  it("is deterministic regardless of property insertion order (lexical fallback order)", () => {
    const titleA = { fr: "Français", de: "Deutsch" };
    const titleB = { de: "Deutsch", fr: "Français" };
    expect(names({ title: titleA })).toEqual(names({ title: titleB }));
    expect(names({ title: titleA })).toEqual(["Deutsch"]);
  });

  it("never trims a valid title (surrounding whitespace preserved)", () => {
    expect(names({ title: { en: "  Padded  " } })).toEqual(["  Padded  "]);
  });
});

describe("normalizeAppList: mainService negative cases", () => {
  const app = (store: Record<string, unknown>): AppInfo =>
    normalizeAppList(appPayload("synth-main", store))[0]!;

  it("omits mainService for invalid values (space, empty, oversize, leading _/., non-string)", () => {
    // The approved regex /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ makes a leading
    // "_" or "." invalid (the first character must be alphanumeric).
    for (const main of [
      "web server",
      "",
      "a".repeat(129),
      "_leading",
      ".leading",
      5,
      ["web"],
      null,
    ]) {
      const result = app({ title: "App", main });
      expect(Object.prototype.hasOwnProperty.call(result, "mainService")).toBe(false);
    }
  });

  it("accepts a trailing '-' main (allowed by the regex) while rejecting leading '_'/'.'", () => {
    expect(app({ title: "App", main: "trailing-" })).toMatchObject({
      mainService: "trailing-",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        app({ title: "App", main: "_leading" }),
        "mainService",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        app({ title: "App", main: ".leading" }),
        "mainService",
      ),
    ).toBe(false);
  });

  it("reads mainService only from the entry's OWN store_info.main (never store_info.prototype or the payload root)", () => {
    const withMain = { title: "App", main: "web" };
    // store_info WITH an own `main` (inherited title only):
    const storeWithMain = Object.create(withMain);
    storeWithMain["main"] = "web";
    expect(Object.prototype.hasOwnProperty.call(storeWithMain, "main")).toBe(true);
    const appWithMain = normalizeAppList(appPayload("synth-ownmain", storeWithMain))[0]!;
    expect(Object.prototype.hasOwnProperty.call(appWithMain, "mainService")).toBe(true);
    expect(appWithMain).toMatchObject({ mainService: "web" });

    // store_info WITHOUT an own `main`, inheriting one from its prototype:
    const storeNoOwnMain = Object.create(withMain);
    delete storeNoOwnMain["main"];
    expect(Object.prototype.hasOwnProperty.call(storeNoOwnMain, "main")).toBe(false);
    const resultInherited = normalizeAppList(
      appPayload("synth-inhermain", storeNoOwnMain),
    )[0]!;
    expect(Object.prototype.hasOwnProperty.call(resultInherited, "mainService")).toBe(
      false,
    );

    // Entry has no store_info at all; the payload root carries store_info.main:
    const payload: Record<string, unknown> = {
      "synth-rootmain": { status: "running", store_info: { title: "App" } },
    };
    (payload as Record<string, unknown>)["store_info"] = { title: "App", main: "web" };
    const resultRoot = normalizeAppList(payload)[0]!;
    expect(Object.prototype.hasOwnProperty.call(resultRoot, "mainService")).toBe(false);
  });

  it("omits oversized main (129 chars) but accepts the 128-char boundary", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        app({ title: "App", main: "a".repeat(129) }),
        "mainService",
      ),
    ).toBe(false);
    expect(app({ title: "App", main: "a".repeat(128) })).toMatchObject({
      mainService: "a".repeat(128),
    });
  });

  it("drops unrelated store keys (env/compose/tips/secret) from the normalized output", () => {
    const result = app({
      title: "App",
      main: "web",
      env: { FOO: "bar" },
      compose: "services: {}",
      tips: ["tip"],
      secret: "s3cr3t",
    });
    expect(Object.keys(result).sort()).toEqual([
      "id",
      "isUncontrolled",
      "mainService",
      "name",
      "status",
      "updateAvailable",
    ]);
    expect(JSON.stringify(result)).not.toContain("s3cr3t");
    expect(JSON.stringify(result)).not.toContain("services: {}");
  });
});

describe("normalizeContainers: isMainService negative cases", () => {
  const members = (payload: unknown) =>
    Object.fromEntries(normalizeContainers(payload).map((c) => [c.service, c]));

  it("omits all flags when main is missing or invalid", () => {
    const containers = { db: containerRec("db"), web: containerRec("web") };
    // The approved regex makes a leading "_" invalid (first char must be
    // alphanumeric); trailing "-" would be valid.
    for (const main of [undefined, "", "bad name", "_x", 1]) {
      const result = members(containersPayload(main, containers));
      for (const c of Object.values(result)) {
        expect(Object.prototype.hasOwnProperty.call(c, "isMainService")).toBe(false);
      }
    }
  });

  it("omits all flags when main does not match any containers entry (no first/sole default)", () => {
    const result = members(
      containersPayload("missing-svc", {
        db: containerRec("db"),
        web: containerRec("web"),
      }),
    );
    for (const c of Object.values(result)) {
      expect(Object.prototype.hasOwnProperty.call(c, "isMainService")).toBe(false);
    }
  });

  it("omits all flags when the declared main entry is an array (non-record)", () => {
    const result = members(
      containersPayload("web", { db: containerRec("db"), web: [1, 2, 3] }),
    );
    // Legacy behavior: array entries still yield a service-only member;
    // but the declared-main check requires a non-array record, so no flags.
    expect(Object.keys(result)).toEqual(["db", "web"]);
    expect(Object.prototype.hasOwnProperty.call(result["db"], "isMainService")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(result["web"], "isMainService")).toBe(
      false,
    );
  });

  it("omits only the contradicting member's flag when its reported Service differs from its map key", () => {
    const result = members(
      containersPayload("db", {
        db: containerRec("db", { Service: "actually-other" }),
        web: containerRec("web"),
      }),
    );
    expect(
      Object.prototype.hasOwnProperty.call(result["actually-other"], "isMainService"),
    ).toBe(false);
    expect(result["web"]).toMatchObject({ isMainService: false });
  });

  it("keeps unrelated container keys out of the normalized output and preserves existing fields", () => {
    const result = normalizeContainers(
      containersPayload("web", {
        web: containerRec("web", {
          Environment: { A: "b" },
          Compose: "services: {}",
          Password: "s3cr3t",
          // Legacy singular `Publisher` is not a mapped field.
          Publisher: [{ HostPort: "8080", ContainerPort: "80" }],
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]!).sort()).toEqual([
      "health",
      "id",
      "image",
      "isMainService",
      "name",
      "ports",
      "service",
      "state",
      "status",
    ]);
    expect(JSON.stringify(result)).not.toContain("s3cr3t");
    expect(result[0]).toMatchObject({ service: "web", isMainService: true, ports: [] });
  });

  it("preserves all previously mapped fields (including publishers) unchanged when the isMainService flag is present", () => {
    const result = normalizeContainers(
      containersPayload("web", {
        db: containerRec("db"),
        web: containerRec("web", {
          State: "running",
          Status: "Up 5 minutes",
          Health: "healthy",
          Publishers: [
            {
              Protocol: "tcp",
              PublishedPort: 8080,
              TargetPort: "80",
              URL: "http://example.test",
            },
            { Protocol: "udp", PublishedPort: "9090", TargetPort: 9090 },
          ],
        }),
      }),
    );
    expect(result).toHaveLength(2);
    const byService = Object.fromEntries(result.map((c) => [c.service, c]));
    const web = byService["web"]!;
    expect(web).toMatchObject({
      id: "id-web",
      name: "name-web",
      image: "registry.example/test/web:latest",
      service: "web",
      state: "running",
      status: "Up 5 minutes",
      health: "healthy",
      isMainService: true,
      ports: [
        {
          protocol: "tcp",
          publishedPort: 8080,
          targetPort: 80,
          url: "http://example.test",
        },
        // Legacy numeric-string coercion: "9090" maps to the number 9090.
        { protocol: "udp", publishedPort: 9090, targetPort: 9090, url: undefined },
      ],
    });
    expect(Object.keys(web).sort()).toEqual([
      "health",
      "id",
      "image",
      "isMainService",
      "name",
      "ports",
      "service",
      "state",
      "status",
    ]);
    const db = byService["db"]!;
    expect(db).toMatchObject({ isMainService: false, ports: [] });
  });

  it("reads the isMainService declaration only from the payload's OWN main (inherited root.main never flags members)", () => {
    const withMain = { main: "web", containers: { web: containerRec("web") } };
    const root = Object.create(withMain);
    delete root["main"];
    delete root["containers"];
    expect(Object.prototype.hasOwnProperty.call(root, "main")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(root, "containers")).toBe(false);
    // Legacy: the inherited `containers` record is still iterated and yields
    // a member, but the inherited root `main` cannot manufacture the flag.
    const result = normalizeContainers(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ service: "web", ports: [] });
    for (const c of result) {
      expect(Object.prototype.hasOwnProperty.call(c, "isMainService")).toBe(false);
    }
  });

  it("keeps legacy handling of an array-valued containers collection unchanged (members yielded, new flags omitted)", () => {
    // Legacy behavior: an array `containers` collection is iterated like a
    // record (Object.entries over index keys); members are still yielded.
    // The declared-main guard requires own `main`/`containers` record
    // matching, so no member gets the isMainService flag.
    const result = normalizeContainers(containersPayload("web", [containerRec("web")]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ service: "web", ports: [] });
    expect(Object.prototype.hasOwnProperty.call(result[0], "isMainService")).toBe(false);
  });
});

describe("normalizeContainers: isMainService positive case", () => {
  it("flags the declared main true and the other service false (2-service case)", () => {
    const result = normalizeContainers(
      containersPayload("web", {
        db: containerRec("db"),
        web: containerRec("web"),
      }),
    );
    expect(result).toHaveLength(2);
    const byService = Object.fromEntries(result.map((c) => [c.service, c]));
    expect(Object.prototype.hasOwnProperty.call(byService["web"], "isMainService")).toBe(
      true,
    );
    expect(Object.prototype.hasOwnProperty.call(byService["db"], "isMainService")).toBe(
      true,
    );
    expect(byService["web"]).toMatchObject({ isMainService: true });
    expect(byService["db"]).toMatchObject({ isMainService: false });
  });
});
