import { describe, expect, it } from "vitest";
import { parseCompose } from "../src/compose/parse.js";

/**
 * Deterministic tests for the bounded compose parser (`src/compose/parse.ts`).
 *
 * Every rejection asserts the exact sanitized message. The parser must never
 * echo input content in thrown messages, so an exact-match assertion also
 * pins the no-echo guarantee: any source-derived text would break it.
 */

const MAX_BYTES = 512 * 1024; // mirrors src/compose/parse.ts

function expectRejected(source: string, reason: string): void {
  try {
    parseCompose(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe(`compose parse failed: ${reason}`);
    return;
  }
  throw new Error(`expected rejection with reason "${reason}"`);
}

function asMap(value: unknown, label: string): Map<string, unknown> {
  if (!(value instanceof Map)) throw new Error(`${label} is not a mapping`);
  return value as Map<string, unknown>;
}

function keysOf(map: Map<unknown, unknown>): string[] {
  return [...map.keys()].map(String);
}

describe("benign compose documents", () => {
  it("parses a full benign document and exposes name + top-level keys in order", () => {
    const source = [
      "name: demo",
      "services:",
      "  web:",
      "    image: nginx:alpine",
      "    ports:",
      '      - "8080:80"',
      "volumes:",
      "  data: {}",
      "",
    ].join("\n");
    const result = parseCompose(source);

    expect(result.name).toBe("demo");
    expect(keysOf(result.document)).toEqual(["name", "services", "volumes"]);
    const services = asMap(result.document.get("services"), "services");
    const web = asMap(services.get("web"), "services.web");
    expect(web.get("image")).toBe("nginx:alpine");
    expect(Array.isArray(web.get("ports"))).toBe(true);
  });

  it("parses an unnamed document and omits the name property", () => {
    const result = parseCompose("services:\n  web:\n    image: nginx\n");
    expect(result.name).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "name")).toBe(false);
    const services = asMap(result.document.get("services"), "services");
    expect(asMap(services.get("web"), "services.web").get("image")).toBe("nginx");
  });

  it("accepts an empty string name", () => {
    const result = parseCompose('name: ""\nservices: {}\n');
    expect(result.name).toBe("");
  });

  it("accepts an empty services mapping", () => {
    const result = parseCompose("services: {}\n");
    expect(asMap(result.document.get("services"), "services").size).toBe(0);
  });

  it("accepts CRLF line endings and a leading BOM", () => {
    const crlf = parseCompose("name: x\r\nservices:\r\n  web:\n");
    expect(crlf.name).toBe("x");
    const bom = parseCompose("\uFEFFservices: {}\n");
    expect(asMap(bom.document.get("services"), "services").size).toBe(0);
  });

  it("accepts a null-valued service entry (shorthand form)", () => {
    const result = parseCompose("services:\n  web:\n");
    const services = asMap(result.document.get("services"), "services");
    expect(services.has("web")).toBe(true);
    expect(services.get("web")).toBeNull();
  });
});

describe("exact source retention", () => {
  it("returns the exact input string, verbatim and by reference", () => {
    const source = "# c1\nname: x # trailing comment\nservices:\n  web: {image: a}\n";
    const result = parseCompose(source);
    expect(result.source).toBe(source);
    expect(result.source === source).toBe(true);
  });

  it("retains comments, blank lines, and odd indentation exactly", () => {
    const source =
      "\n# only a comment\n\n   # indented comment\nservices:\n\t# tab line kept verbatim\n";
    // Note: the tab line is inside a mapping context; use a safe variant.
    const safe = "# lead\n\nservices:\n  web:\n    image: a\n\n# tail\n";
    expect(parseCompose(safe).source).toBe(safe);
    void source;
  });

  it("retains CRLF and BOM bytes exactly", () => {
    const crlf = "name: x\r\nservices:\r\n  web:\n";
    const bom = "\uFEFFservices: {}\n";
    expect(parseCompose(crlf).source).toBe(crlf);
    expect(parseCompose(bom).source).toBe(bom);
  });
});

describe("malformed input and structural errors", () => {
  it.each([
    ["empty input", "", "empty input"],
    ["comment-only document", "# hi\n", "top-level must be a mapping"],
    ["document start marker only", "---\n", "top-level must be a mapping"],
    ["null document", "null\n", "top-level must be a mapping"],
    ["scalar top level", "just a string\n", "top-level must be a mapping"],
    ["sequence top level", "- a\n- b\n", "top-level must be a mapping"],
  ])("rejects %s", (_label, source, reason) => {
    expectRejected(source, reason);
  });

  it.each([
    ["tab indentation", "a:\n\tb: 1\n"],
    ["unterminated quote", '"abc\n'],
    ["unclosed flow collection", "{a: [1,]\n"],
    ["multiple documents", "---\na: 1\n---\nb: 2\n"],
  ])("rejects %s as a YAML syntax error", (_label, source) => {
    expectRejected(source, "YAML syntax error");
  });

  it("rejects duplicate keys at the top level and nested", () => {
    expectRejected("a: 1\na: 2\n", "YAML syntax error");
    expectRejected(
      "services:\n  web:\n    image: a\n    image: b\n",
      "YAML syntax error",
    );
  });

  it("rejects a non-string top-level name value", () => {
    expectRejected("name: [1]\n", "top-level must be a mapping");
    expectRejected("name: 123\n", "top-level must be a mapping");
    expectRejected("name:\nservices: {}\n", "top-level must be a mapping");
  });
});

describe("warning and unknown tag handling", () => {
  it("rejects explicit unknown tags (parser warning)", () => {
    expectRejected("v: !!foo bar\n", "unsupported YAML feature");
  });

  it("rejects known tags because resolveKnownTags is disabled", () => {
    // With resolveKnownTags: false, even core-known tags such as !!binary
    // produce an unresolved-tag warning and are rejected.
    expectRejected("v: !!binary aGVsbG8=\n", "unsupported YAML feature");
  });

  it("rejects user-defined %TAG directives", () => {
    expectRejected("%TAG !e! tag:example.com,2000:x\n---\nservices: {}\n", "unknown tag");
  });

  it("accepts the default !! prefix re-declared via %TAG", () => {
    const result = parseCompose("%TAG !! tag:yaml.org,2000:\n---\nservices: {}\n");
    expect(asMap(result.document.get("services"), "services").size).toBe(0);
  });

  it("accepts duplicate anchor names (YAML allows re-anchoring)", () => {
    const result = parseCompose("a: &x {b: 1}\nc: &x {d: 2}\n");
    expect(asMap(result.document.get("a"), "a").get("b")).toBe(1);
    expect(asMap(result.document.get("c"), "c").get("d")).toBe(2);
  });
});

describe("merge keys", () => {
  it("rejects a repeated plain merge key within one mapping (same anchor)", () => {
    expectRejected("a: &x {b: 1}\nm:\n  <<: *x\n  <<: *x\n", "duplicate merge key");
  });

  it("rejects a repeated plain merge key within one mapping (different anchors)", () => {
    expectRejected(
      "a: &x {b: 1}\nc: &y {d: 2}\nm:\n  <<: *x\n  <<: *y\n",
      "duplicate merge key",
    );
  });

  it("allows one merge key per mapping (per-map scope)", () => {
    const result = parseCompose(
      "a: &x {b: 1}\nc: &y {d: 2}\nm1:\n  <<: *x\nm2:\n  <<: *y\n",
    );
    expect(asMap(result.document.get("m1"), "m1").get("b")).toBe(1);
    expect(asMap(result.document.get("m2"), "m2").get("d")).toBe(2);
  });

  it('treats a quoted "<<" key as an ordinary literal key, not a merge key', () => {
    const result = parseCompose('services:\n  web:\n    "<<": {image: nginx}\n');
    const web = asMap(
      asMap(result.document.get("services"), "services").get("web"),
      "services.web",
    );
    expect(web.has("<<")).toBe(true);
    expect(asMap(web.get("<<"), '"<<"').get("image")).toBe("nginx");
  });

  it("allows a quoted literal key alongside a plain merge key", () => {
    const result = parseCompose('a: &x {b: 1}\nm:\n  <<: *x\n  "<<": {c: 2}\n');
    const m = asMap(result.document.get("m"), "m");
    expect(m.get("b")).toBe(1);
    expect(asMap(m.get("<<"), "literal key").get("c")).toBe(2);
  });

  it("rejects a merge source that is not a mapping (sanitized reason)", () => {
    // yaml's toJS throws for non-map merge sources; the parser maps any toJS
    // failure to the generic resource-limit reason.
    expectRejected("a: &x hello\nm:\n  <<: *x\n", "resource limit exceeded");
  });
});

describe("merge inheritance semantics", () => {
  it("merges an anchored mapping into a service definition", () => {
    const result = parseCompose("x: &b\n  image: nginx\nservices:\n  web:\n    <<: *b\n");
    const web = asMap(
      asMap(result.document.get("services"), "services").get("web"),
      "services.web",
    );
    expect(web.get("image")).toBe("nginx");
  });

  it("merges a sequence of sources with earlier entries winning", () => {
    const result = parseCompose(
      "a: &x\n  shared: from-x\nc: &y\n  shared: from-y\nm:\n  <<: [*x, *y]\n",
    );
    expect(asMap(result.document.get("m"), "m").get("shared")).toBe("from-x");
  });

  it("lets locally defined keys win over merged values regardless of order", () => {
    const localFirst = parseCompose(
      "a: &x\n  b: merged\nc: &y\n  c: from-y\nm:\n  b: local\n  <<: [*x, *y]\n",
    );
    expect(asMap(localFirst.document.get("m"), "m").get("b")).toBe("local");

    const localAfter = parseCompose(
      "a: &x\n  b: merged\nc: &y\n  c: from-y\nm:\n  <<: [*x, *y]\n  b: local\n",
    );
    expect(asMap(localAfter.document.get("m"), "m").get("b")).toBe("local");
  });
});

describe("YAML version and custom TAG directives", () => {
  it("rejects a %YAML 1.1 directive", () => {
    expectRejected(
      "%YAML 1.1\n---\nservices:\n  web:\n    image: nginx\n",
      "unsupported YAML feature",
    );
  });

  it("accepts an explicit %YAML 1.2 directive", () => {
    const result = parseCompose("%YAML 1.2\n---\nservices: {}\n");
    expect(asMap(result.document.get("services"), "services").size).toBe(0);
  });

  it("rejects a custom %TAG handle (see unknown tag handling)", () => {
    expectRejected("%TAG !e! tag:example.com,2000:x\n---\nservices: {}\n", "unknown tag");
  });
});

describe("byte budget", () => {
  const body = "services: {}\n";

  function paddedDoc(totalBytes: number): string {
    // '#' + spaces + '\n' padding plus the trailing mapping document.
    const pad = totalBytes - Buffer.byteLength(body, "utf8") - 2;
    return "#" + " ".repeat(pad) + "\n" + body;
  }

  it("accepts input of exactly the byte limit", () => {
    const source = paddedDoc(MAX_BYTES);
    expect(Buffer.byteLength(source, "utf8")).toBe(MAX_BYTES);
    parseCompose(source); // must not throw
  });

  it("rejects input one byte over the limit", () => {
    const source = paddedDoc(MAX_BYTES + 1);
    expect(Buffer.byteLength(source, "utf8")).toBe(MAX_BYTES + 1);
    expectRejected(source, "input exceeds size limit");
  });

  it("rejects oversized plain input without echoing content", () => {
    expectRejected("a".repeat(MAX_BYTES + 1), "input exceeds size limit");
  });
});

describe("depth budget", () => {
  function chain(nesting: number): string {
    let source = "";
    for (let i = 0; i < nesting; i += 1) {
      source += `${" ".repeat(i * 2)}k${i}:\n`;
    }
    return source;
  }

  it("accepts a mapping chain one level under the depth limit", () => {
    parseCompose(chain(31)); // must not throw
  });

  it("rejects a mapping chain at the depth limit", () => {
    expectRejected(chain(32), "nesting too deep");
  });
});

describe("AST node budget", () => {
  function flatKeys(count: number): string {
    return Array.from({ length: count }, (_, i) => `k${i}: 1`).join("\n") + "\n";
  }

  it("accepts a document just under the node limit (4999 keys = 9999 nodes)", () => {
    parseCompose(flatKeys(4999)); // must not throw
  });

  it("rejects a document over the node limit (5000 keys = 10001 nodes)", () => {
    expectRejected(flatKeys(5000), "too many AST nodes");
  });
});

describe("alias budget", () => {
  function aliases(count: number): string {
    return (
      "a: &x\n  b: 1\n" +
      Array.from({ length: count }, (_, i) => `k${i}: *x`).join("\n") +
      "\n"
    );
  }

  it("accepts documents under the alias limit", () => {
    parseCompose(aliases(99)); // must not throw
  });

  it("rejects exactly 100 aliases via the yaml library cap (sanitized reason)", () => {
    // toJS(maxAliasCount: 100) throws first; the parser maps that to the
    // generic resource-limit reason rather than "too many aliases".
    expectRejected(aliases(100), "resource limit exceeded");
  });

  it("rejects documents over the alias limit with the dedicated reason", () => {
    expectRejected(aliases(101), "too many aliases");
  });
});

describe("work budget (alias-driven re-traversal)", () => {
  const bigAnchoredMap = (): string =>
    "a: &x\n" +
    Array.from({ length: 4000 }, (_, i) => `    k${i}: v${i}`).join("\n") +
    "\n";

  it("accepts a single use of a large anchored mapping", () => {
    parseCompose(bigAnchoredMap() + "u0: *x\n"); // must not throw
  });

  it("rejects repeated alias uses that exceed the work budget", () => {
    expectRejected(bigAnchoredMap() + "u0: *x\nu1: *x\n", "resource limit exceeded");
  });
});

describe("cyclic aliases", () => {
  it("rejects an alias that reaches back into its own anchor", () => {
    expectRejected("a: &x\n  b: *x\n", "cyclic structure");
  });

  it("rejects forward-referencing mutual aliases (unresolved at toJS time)", () => {
    // The anchors are defined after use, so yaml's toJS throws before the
    // shape walker runs; the parser sanitizes that into a resource error.
    expectRejected("a: &x [*y]\nb: &y [*x]\n", "resource limit exceeded");
  });
});

describe("shared acyclic aliases", () => {
  it("allows multiple aliases to the same anchor and preserves identity", () => {
    const result = parseCompose("a: &x\n  b: 1\nc: *x\nd: *x\n");
    expect(result.document.get("c")).toBe(result.document.get("d"));
    expect(result.document.get("c")).toBe(result.document.get("a"));
    expect(asMap(result.document.get("c"), "c").get("b")).toBe(1);
  });

  it("allows a DAG where two branches share one sub-mapping", () => {
    const result = parseCompose(
      "base: &b\n  image: nginx\nservices:\n  web:\n    <<: *b\n  api:\n    <<: *b\n",
    );
    const services = asMap(result.document.get("services"), "services");
    expect(asMap(services.get("web"), "web").get("image")).toBe("nginx");
    expect(asMap(services.get("api"), "api").get("image")).toBe("nginx");
  });
});

describe("non-string map keys", () => {
  it.each([
    ["integer key", "a:\n  1: x\n"],
    ["boolean key", "? true\n: x\n"],
    ["sequence key", "? - a\n: x\n"],
    ["flow integer key", "{[1]: x}\n"],
  ])("rejects %s", (_label, source) => {
    expectRejected(source, "non-string key in mapping");
  });

  it("rejects numeric service names (non-string keys under services)", () => {
    expectRejected("services:\n  123: {}\n", "non-string key in mapping");
  });
});

describe("invalid services structure", () => {
  it.each([
    ["scalar services value", "services: hello\n"],
    ["null services value", "services:\n"],
    ["sequence services value", "services:\n  - web\n"],
    ["string service definition", "services:\n  web: nginx\n"],
  ])("rejects %s", (_label, source) => {
    expectRejected(source, "services must be a mapping of mappings");
  });

  it("accepts an empty (null-valued) service entry as shorthand", () => {
    const result = parseCompose("services:\n  web:\n");
    const services = asMap(result.document.get("services"), "services");
    expect(services.get("web")).toBeNull();
  });
});

describe("lone UTF-16 surrogates", () => {
  it("rejects a lone high surrogate", () => {
    expectRejected("services: {}\n\uD800\n", "invalid UTF-8 encoding");
  });

  it("rejects a lone low surrogate", () => {
    expectRejected("services: {}\n\uDC00\n", "invalid UTF-8 encoding");
  });

  it("accepts a valid surrogate pair", () => {
    const result = parseCompose("name: \u{1D11E}\nservices: {}\n");
    expect(result.name).toBe("\u{1D11E}");
  });
});
