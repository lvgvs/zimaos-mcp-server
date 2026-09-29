/**
 * Bounded YAML parsing for Docker Compose files.
 *
 * `parseCompose` parses a single-document compose file into a plain-JS value
 * tree (mappings as `Map`) with hard resource limits and sanitized errors:
 * no input content is ever echoed back in thrown messages.
 */

import { parseDocument, isAlias, isMap, isScalar, isSeq } from "yaml";
import type { ParsedNode } from "yaml";

export interface ParseComposeResult {
  /** The exact source string that was parsed (preserved verbatim). */
  readonly source: string;
  /** Top-level compose mapping. */
  readonly document: Map<string, unknown>;
  /** Value of the top-level `name` key, when present and a string. */
  readonly name?: string;
}

const MAX_BYTES = 512 * 1024; // 512 KiB UTF-8 input limit
const MAX_AST_NODES = 10_000;
const MAX_DEPTH = 32;
const MAX_ALIASES = 100;
const MAX_WORK = 20_000;

/** Fixed, source-free reason phrases for sanitized errors. */
type Reason =
  | "empty input"
  | "invalid UTF-8 encoding"
  | "input exceeds size limit"
  | "YAML syntax error"
  | "duplicate key"
  | "unknown tag"
  | "unsupported YAML feature"
  | "too many AST nodes"
  | "nesting too deep"
  | "too many aliases"
  | "resource limit exceeded"
  | "cyclic structure"
  | "top-level must be a mapping"
  | "non-string key in mapping"
  | "duplicate merge key"
  | "services must be a mapping of mappings";

function fail(reason: Reason): never {
  throw new Error(`compose parse failed: ${reason}`);
}

/** Reject source containing unpaired UTF-16 surrogate code units. */
function assertValidUtf16(source: string): void {
  for (let i = 0; i < source.length; i += 1) {
    const unit = source.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      // High surrogate must be followed by a low surrogate.
      const next = i + 1 < source.length ? source.charCodeAt(i + 1) : -1;
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid UTF-8 encoding");
      i += 1; // consume the pair
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      // Lone low surrogate.
      fail("invalid UTF-8 encoding");
    }
  }
}

interface AstStats {
  nodes: number;
  aliases: number;
}

/**
 * Walk the parsed AST counting nodes/aliases, tracking max depth, and
 * rejecting repeated merge keys (`<<`) within a single mapping.
 */
function walkAst(node: ParsedNode, depth: number, stats: AstStats): void {
  if (depth > MAX_DEPTH) fail("nesting too deep");
  stats.nodes += 1;
  if (stats.nodes > MAX_AST_NODES) fail("too many AST nodes");

  if (isMap(node)) {
    let mergeKeys = 0;
    for (const pair of node.items) {
      const key = pair.key;
      // A merge key is a scalar whose value is '<<', or whose string form
      // (source) is '<<' — the latter covers keys already consumed by merge
      // resolution, which leaves `value === undefined`.
      if (isScalar(key) && key.type === "PLAIN" && key.source === "<<") {
        mergeKeys += 1;
        if (mergeKeys > 1) fail("duplicate merge key");
      }
      walkAst(key, depth + 1, stats);
      if (pair.value !== null) walkAst(pair.value, depth + 1, stats);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      walkAst(item, depth + 1, stats);
    }
  } else if (isAlias(node)) {
    stats.aliases += 1;
    if (stats.aliases > MAX_ALIASES) fail("too many aliases");
  }
}

/**
 * Cycle-aware traversal of the plain-JS value tree produced by `toJS`.
 * Shared acyclic DAGs are allowed; a node already on the active path is a
 * cycle and rejected. Every visit (and every entry inspected) counts as one
 * unit of work, bounding alias-driven re-traversal.
 */
function assertJsShape(
  value: unknown,
  active: Set<object>,
  work: { count: number },
): void {
  const spend = (): void => {
    work.count += 1;
    if (work.count > MAX_WORK) fail("resource limit exceeded");
  };

  spend();
  if (value === null || typeof value !== "object") return;

  if (active.has(value)) fail("cyclic structure");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsShape(item, active, work);
    } else if (value instanceof Map) {
      for (const [key, entry] of value) {
        spend();
        if (typeof key !== "string") fail("non-string key in mapping");
        assertJsShape(entry, active, work);
      }
    } else {
      // Plain objects are not produced by toJS with mapAsMap; reject anyway.
      for (const [key, entry] of Object.entries(value)) {
        spend();
        if (typeof key !== "string") fail("non-string key in mapping");
        assertJsShape(entry, active, work);
      }
    }
  } finally {
    active.delete(value);
  }
}

export function parseCompose(source: string): ParseComposeResult {
  if (source.length === 0) fail("empty input");
  assertValidUtf16(source);
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) fail("input exceeds size limit");

  const doc = parseDocument(source, {
    version: "1.2",
    schema: "core",
    merge: true,
    strict: true,
    uniqueKeys: true,
    resolveKnownTags: false,
    prettyErrors: false,
  });

  if (doc.errors.length > 0) fail("YAML syntax error");
  if (doc.warnings.length > 0) fail("unsupported YAML feature");
  if (doc.directives.yaml.version !== "1.2") fail("unsupported YAML feature");
  // Reject user-defined %TAG directives; the default `!!` prefix is always
  // present and must be ignored.
  for (const handle of Object.keys(doc.directives.tags)) {
    if (handle !== "!!") fail("unknown tag");
  }

  const contents = doc.contents;
  if (!isMap(contents)) fail("top-level must be a mapping");

  const stats: AstStats = { nodes: 0, aliases: 0 };
  walkAst(contents, 1, stats);

  let value: unknown;
  try {
    value = doc.toJS({ mapAsMap: true, maxAliasCount: MAX_ALIASES });
  } catch {
    fail("resource limit exceeded");
  }

  if (!(value instanceof Map)) fail("top-level must be a mapping");
  const document = value as Map<unknown, unknown>;

  assertJsShape(document, new Set<object>(), { count: 0 });

  // Basic compose shape: `services` (when present) maps string names to
  // mappings; each service definition may also be empty (`null`).
  if (document.has("services")) {
    const services = document.get("services");
    if (!(services instanceof Map)) fail("services must be a mapping of mappings");
    for (const [name, def] of services) {
      if (typeof name !== "string") fail("non-string key in mapping");
      if (def === null || def === undefined) continue; // `service:` shorthand
      if (!(def instanceof Map)) fail("services must be a mapping of mappings");
    }
  }

  let name: string | undefined;
  if (document.has("name")) {
    const candidate = document.get("name");
    if (typeof candidate !== "string") fail("top-level must be a mapping");
    name = candidate;
  }

  return {
    source,
    document: document as Map<string, unknown>,
    ...(name !== undefined ? { name } : {}),
  };
}
