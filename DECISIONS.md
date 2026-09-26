# Decisions

Architectural decisions actually made during Phase 1 implementation. Routine
engineering choices are not recorded here; see `STATUS.md` for state and
`docs/RESEARCH.md` for API findings.

## 2026-09-26 — MCP transport: Streamable HTTP over a single authenticated endpoint

**Decision:** Expose the server as an authenticated Streamable HTTP MCP endpoint at
`POST /mcp`, with a separate unauthenticated `GET /health` readiness probe on the same
HTTP server.

**Reason:** The product must be reachable by remote MCP clients and require
authentication for all MCP traffic (AGENTS.md security model). A single bearer-protected
endpoint plus an open health check is the smallest surface that satisfies both.

**Rejected alternative:** stdio transport only — cannot serve networked MCP clients, which
is a Phase 1 requirement.

## 2026-09-26 — `/health` readiness contract

**Decision:** `GET /health` returns HTTP 200 with body
`{ status: "ok" | "degraded", service: "zimaos-mcp-server", ready: boolean }`. Readiness is
derived from an injected `isReady()` callback (defaults to true). The endpoint requires no
authentication.

**Reason:** Container health checks and orchestrators need a cheap, unauthenticated probe;
`status` distinguishes healthy vs degraded without changing the HTTP status code.

## 2026-09-26 — Fail-fast auth at startup (no in-process wait loop)

**Decision:** The entrypoint performs ZimaOS login once at boot and exits non-zero if it
fails; container restart policy is relied upon to retry until ZimaOS is reachable.

**Reason:** Keeps the process simple and avoids an unbounded internal retry loop. A
misconfigured or unreachable ZimaOS should surface as a failing container, not a silently
hung one.

## 2026-09-26 — App control disabled by default; read/control separation

**Decision:** Application start/stop/restart tools are gated behind the permission layer and
disabled unless explicitly enabled in config. Read-only tools (list/detail/logs/system info)
are always available when authenticated.

**Reason:** AGENTS.md requires application-control operations to be off by default and a clear
separation between read and control operations.

## 2026-09-26 — `probeComposeAppHealth` uses the raw authenticated request, not the envelope parser

**Decision:** The compose health-check call is made with the client's raw authenticated
request path (HTTP status is the signal) rather than through the `{success,message,data}`
envelope parser.

**Reason:** Per `docs/RESEARCH.md`, the health endpoint is a `BaseResponse` where HTTP status,
not an envelope body, indicates success. Routing it through the envelope parser misreported a
200 with an empty body as "unhealthy". This was found and fixed during test development.

## 2026-09-26 — Test architecture: fake-fetch harness + InMemoryTransport + real HTTP round trip

**Decision:** Automated tests use three layers, all mocked (no network):

1. A shared fake `fetch` harness (`tests/helpers/fakeZimaOs.ts`) keyed by `"METHOD /path"` for
   client-level session/normalization tests.
2. A real `McpServer` over the SDK's in-memory transport with mocked domain services for
   tool-layer tests (read/control separation, validation, bounded logs).
3. A real HTTP server round trip with bearer auth for transport tests (auth rejection, health
   readiness, authenticated MCP initialize + listTools).

**Reason:** Covers config, client session behavior, permission layer, tool semantics, and the
HTTP/auth boundary without depending on the disposable VM; CI stays hermetic.

## 2026-09-26 — Separate strict test type-check config (`tsconfig.test.json`)

**Decision:** Add `tsconfig.test.json` (extends the main strict config, includes `src` +
`tests`, `noEmit`) so tests are type-checked under the same strictness as source.

**Reason:** Tests were previously outside any tsconfig and therefore never type-checked; this
closes that gap without weakening the production build config.
