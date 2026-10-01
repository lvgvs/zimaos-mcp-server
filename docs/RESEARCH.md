# ZimaOS API Research

Authoritative research for the ZimaOS MCP Server. Every API operation used by the
implementation is recorded here with its authoritative source and implementation
implication, per `AGENTS.md`. Copied source text is kept minimal; concise technical
summaries are preferred.

## Sources (priority order)

1. **ZimaSpace OpenAPI developer guide** — official documentation.
   - https://www.zimaspace.com/docs/zimaos/openapi-developer-guide
   - https://www.zimaspace.com/docs/developer/openapi-developer-guide
2. **IceWhale-OpenAPI** — official OpenAPI specifications (YAML). The canonical repo path
   `github.com/IceWhaleTech/IceWhale-OpenAPI` returned 404 at research time, so the specs
   were retrieved from a verified fork/mirror of that repository:
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos-app-management/app_management/openapi.yaml
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos-user-service/users/openapi_v1.yaml
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos/zimaos/openapi.yaml
3. **Official `@icewhale/*` npm SDKs** (Apache-2.0) — generated from the same specs; used as a
   second verifiable source for endpoint paths and request/response types:
   - `@icewhale/casaos-appmanagement-openapi`
   - `@icewhale/casaos-openapi`
4. **Live integration VM** (authorized, disposable) — ZimaOS v1.7.1, x86_64. Used to confirm
   real response envelopes and field names that the specs leave ambiguous.

> Note: the official `@icewhale/casaos-openapi` SDK declares a base path of `/v2/casaos`, but
> the live ZimaOS v1.7.1 VM serves the core service at **`/v2/zimaos`**. The live value is used.

## API base paths (confirmed)

| Service             | Base path (`servers.url`) | Notes                        |
| ------------------- | ------------------------- | ---------------------------- |
| User service (auth) | `/v1/users`               | login only for this project  |
| App management      | `/v2/app_management`      | compose app lifecycle + logs |
| ZimaOS core         | `/v2/zimaos`              | device/system info           |

All endpoints are plain HTTP on the integration VM. No `curl -k`/`--insecure`.

## Authentication

- **Endpoint:** `POST /v1/users/login` (user service).
- **Request body:** JSON `{ "username": string, "password": string }`.
- **Response envelope:** HTTP 200 with a ZimaOS wrapper object:
  - top-level keys: `success`, `message`, `data`
  - `data.token` is an **object** (not a string): `{ access_token, refresh_token }`.
- **Authorization for subsequent calls:** `Authorization: Bearer <access_token>`.
- The token is kept only in process memory or a permission-restricted temp file and used
  silently; it is never logged, printed, or written to tracked files.

**Implementation implication:** the auth/session client must parse `data.token.access_token`
from an object (not assume a string token), and send `Bearer <token>` on every downstream call.

## App management (`/v2/app_management`)

All responses use the ZimaOS envelope `{ success, message, data }` unless noted. The `data`
field carries the payload described below.

### List installed compose apps — `GET /compose`

- **Response 200** → `ComposeAppListOK`: envelope with `data` = object keyed by app id, each
  value a `ComposeAppWithStoreInfo`. (Live v1.7.1 confirmed: top-level `{ data }`, where
  `data` is an object map; empty when no apps installed.)
- **Implementation implication:** parse `data` as a record/map of app-id → app, not an array.

### App detail — `GET /compose/{id}`

- **Response 200** → `ComposeAppOK`: envelope with `data` = single `ComposeAppWithStoreInfo`.
- Accepts `Accept: application/json` or `application/yaml` (yaml returns interpolated compose).

### Install a compose app — `POST /compose`

- **Request:** body is the Docker Compose YAML content; `Content-Type: application/yaml`.
  Query params: `dry_run=true` (validate only), `check_port_conflict`, `uncontrolled`.
- **Response 200** → `ComposeAppInstallOK`: envelope (`BaseResponse`).
- **Implementation implication:** install is a control operation; must be gated by the
  permission layer and disabled by default.

### Start / restart / stop — `PUT /compose/{id}/status`

- **Request body:** a raw JSON **string** enum, not an object: `"start"`, `"restart"`, or
  `"stop"` (per `requestBodies/RequestComposeAppStatus`). Content-Type `application/json`.
- **Response 200** → `RequestComposeAppStatusOK`: envelope (`BaseResponse`).
- **Implementation implication:** the status body is a JSON string literal; serialize as
  `JSON.stringify("start")` etc. This is a control operation (gated, off by default).

### Containers — `GET /compose/{id}/containers`

- **Response 200** → `ComposeAppContainersOK`: envelope; live v1.7.1 returns only `{ data }`
  (no `success`/`message`). `data` is an object with keys `main` and `containers`;
  `containers` is a map keyed by service name, each value being the container record
  (`ID`, `Name`, `Image`, `Service`, `State`, `Status`, `Health`, `Publishers`, ...).
  It is **not** a flat array.
- **Implementation implication:** normalize from the service-keyed map; envelope handling must
  tolerate responses that omit `success`/`message`.

### Logs — `GET /compose/{id}/logs?lines=N`

- **Query param:** `lines` (number) bounds the log size.
- **Response 200** → `ComposeAppLogsOK`: envelope with `data` = string (the logs).
- **Implementation implication:** always pass a bounded `lines`; cap output length in the MCP
  tool to avoid unbounded payloads.

### Health check — `GET /compose/{id}/healthcheck`

- **Live v1.7.1 behavior:** HTTP status is the usable health signal, not an envelope containing
  health-status data. A healthy app returns HTTP 200 whose body may be empty or a minimal
  `{ message }` object (59 bytes in the live probe) with no structured health fields.
- **Implementation implication:** treat a resolved 2xx as "healthy" (optionally surfacing the
  `message` string); map 404 → unknown and 5xx → unhealthy; never require an envelope with
  health-status data.

## ZimaOS core (`/v2/zimaos`)

### Device info — `GET /device/info`

- **Response 200:** a **bare payload** (no `{success,message,data}` wrapper) of type
  `DeviceInfo`. Live v1.7.1 top-level keys:
  - `arch`, `can_control_powerled`, `cpu` (`{cores, frequency, model, threads}`),
    `device_code`, `device_image_path`, `device_model`, `device_name`, `gpu` (array),
    `hash`, `is_licensed`, `memory` (`{frequency, slots_used, total_byte, type}`),
    `os_version`.
- The spec's minimal `DeviceInfo` schema lists only `device_name`, `device_model`,
  `os_version`, `hash`; the live VM returns a richer set. Model the fields actually returned.

**Implementation implication:** core-service endpoints return data at top level (not wrapped),
unlike app-management and user-service which use the envelope. The system client must not
unwrap a `data` key for `/v2/zimaos/*`.

## Response-envelope rules (confirmed live)

| Endpoint                                          | Envelope                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/users/login`                            | wrapped `{success,message,data}`; `data.token={access_token,refresh_token}`                                            |
| `GET /v2/app_management/compose`                  | wrapped; `data` = object map of app-id → `ComposeAppWithStoreInfo`                                                     |
| `PUT /v2/app_management/compose/{id}/status`      | wrapped (`BaseResponse`)                                                                                               |
| `GET /v2/app_management/compose/{id}/logs`        | wrapped; `data` = string                                                                                               |
| `GET /v2/app_management/compose/{id}/containers`  | live v1.7.1: `{ data }` only (no `success`/`message`); `data={main, containers}` with `containers` a service-keyed map |
| `GET /v2/app_management/compose/{id}/healthcheck` | HTTP status is the signal; 200 body may be empty or minimal `{ message }` (no health-status data)                      |
| `GET /v2/zimaos/device/info`                      | **bare** payload (no wrapper)                                                                                          |

## Container-to-host networking (Custom App deployment)

- **Verified:** A container cannot reach the host's ZimaOS API via `localhost`
  (that is the container itself). The official ZimaSpace developer docs for
  Docker app publishing recommend mapping `host.docker.internal` to the Docker
  host gateway so a Custom App container can call the host API.
- **Authoritative source:** https://www.zimaspace.com/docs/developer/docker-app-publishing
  (ZimaOS developer documentation, "Docker app publishing").
- **Implementation implication:** `deploy/zimaos/docker-compose.yml` uses
  `extra_hosts: ["host.docker.internal:host-gateway"]` and sets
  `ZIMAOS_URL=http://host.docker.internal`. This is the least-privileged option
  — no host networking mode, no Docker socket, no privileged container. The
  disposable integration VM serves its API on port **80**, so the default URL
  omits an explicit port; installs on a non-default port must set it in Compose.

## Compatibility note

- Verified against ZimaOS **v1.7.1** on the authorized disposable integration VM (x86_64).
- The app-management and user-service services use the `{success,message,data}` envelope;
  the core service (`/v2/zimaos`) returns bare payloads. Clients are written to each rule.

## Phase 2 research checkpoint — 2026-09-27

This is research, not implemented behavior. The Astra recovery pass started with clean
`main` and remote main at `a0d7f3a6154fb18e56d4417e36bfe62f513cedf2`
(rewritten equivalent after the approved pre-public history sanitization).
No live ZimaOS requests or mutations were made in this pass. Evidence classes below
separate official documentation, local synthetic experiments, and manager-provided live facts.

### B. Parser: official facts and recovered scratch evidence

Sources verified on 2026-09-27:

- YAML v2 API/options: https://eemeli.org/yaml/
- Exact release license: https://github.com/eemeli/yaml/blob/v2.9.1/LICENSE
- Compose fragments/merge semantics:
  https://github.com/compose-spec/compose-spec/blob/main/10-fragments.md
- Service fields and both mount syntaxes:
  https://github.com/compose-spec/compose-spec/blob/main/05-services.md
- Named-volume drivers/options/external volumes:
  https://github.com/compose-spec/compose-spec/blob/main/07-volumes.md

The existing scratch `p2/parse-test/package.json` and lockfile contain `js-yaml`
5.4.2 (MIT) and `yaml` 2.9.1 (ISC). These are scratch dependencies, not product dependencies.
The original `test-parse.js` was rerun unchanged: **12 passed, 14 failed** (exit 1).
It tests default parsing, short/long volumes, malformed YAML, scalar root, duplicate
keys, and a standard `!!str` tag. It does **not** test a custom executable tag,
Compose schema validation, alias exhaustion, cycles, or prototype pollution.
Its risk fields are on service `db`, but the assertions inspect `web`; both default
parsers leave its merge fields unapplied. Duplicate-key exceptions only print a message
and do not increment the assertion count. Do not cite this script as a passing safety suite.

**Selected parser: `yaml@2.9.1`, ISC**, compatible with original Apache-2.0 source
while retaining the dependency copyright/permission notice. Official docs describe
data parsing into an inspectable Document AST/native values, not Compose execution;
no custom resolvers, revivers, file access, or command execution are needed. YAML
parsing alone does not validate Compose or reproduce ZimaOS interpolation.

Use `parseDocument` with explicit YAML 1.2/core schema, `merge: true`, `strict: true`,
`uniqueKeys: true`, `resolveKnownTags: false`, and `prettyErrors: false`. Inspect
`errors` **and** `warnings` before conversion. Do not log source-containing parser
diagnostics. Do not supply custom tags. Restrict explicit tags to supported core
types/merge and reject unsupported directives or YAML-version changes. Unknown tags
can warn and fall back rather than throw, so merely catching exceptions is unsafe.

The additional synthetic scratch-only `astra-parser-check.cjs` ran **14/14 passing**:

- Explicit merge support exposes inherited privileged/namespace fields; local keys
  override merged keys, and earlier maps win in a merge sequence.
- Ordinary duplicate keys produce `DUPLICATE_KEY`, but repeated `<<` keys are accepted
  even with `uniqueKeys: true`: reject repeated merge keys separately in the AST.
- Unknown tags and disabled known non-core tags produce warnings.
- Core schema keeps `yes` and quoted `"true"` as strings, parses `true` as boolean,
  `012` as decimal 12, and a plain date as a string. Require correct field types;
  do not treat strings such as `"false"`, `on`, or `${FLAG}` as proven safe booleans.
- `doc.toJS({ mapAsMap: true, maxAliasCount: 100 })` preserves maps as Maps,
  including `__proto__`/`constructor` data; the probe did not modify Object.prototype.
  Avoid copying untrusted entries into normal prototype-bearing objects or deep-merge
  utilities. Validate string keys rather than silently coercing complex keys.
- A zero alias budget rejects alias conversion. The documented default budget is
  100; never disable it with -1. Cyclic aliases can still form cyclic JS graphs:
  cycle-aware traversal and explicit rejection are required independently of the budget.
- Multiple documents are rejected by `parseDocument`; syntactically valid
  `services: { web: 123 }` remains parseable and needs structural validation.
- Both short strings and long mapping forms of volumes remain inspectable data.

Resource limits must also bound input bytes, AST depth/node count, traversal work,
and conversion; an alias budget is not a CPU/memory/time guarantee for parsing.
Concrete budgets and adversarial regression tests remain implementation work.
Reject malformed/ambiguous/unsupported input, rather than approving unknown semantics.

### B. Safety analysis design (not an implemented detector)

Parse the original submitted string once per analysis attempt, inspect AST plus bounded
resolved Maps, and retain the exact original UTF-8 string for ZimaOS validation and
installation. Fingerprint those exact bytes, not parsed JSON or reserialized YAML.
Do not normalize whitespace, line endings, comments, tags, or merge structure in the
submitted document. Reject ill-formed Unicode rather than allowing lossy encoding.
New content, including formatting changes, must invalidate prior approval.

Required detection inventory, based on the Compose specification (support by ZimaOS
for every newer field is **not** established):

- `privileged`, including privileged lifecycle hooks; `use_api_socket`.
- Short/long socket mounts (Docker, containerd, CRI-O, Podman), including parent
  directory mounts such as `/run` or `/var/run`; read-only socket mounts are still risky.
- Host `pid`, `ipc`, `network_mode`, `uts`, and `cgroup`; namespace sharing with other
  services/containers must not hide inherited host access.
- `devices` (including CDI selectors) and `device_cgroup_rules`: whole disks,
  `/dev/mem`, `/dev/kmsg`, broad wildcards, and unclassified passthrough need disclosure
  or rejection, not an assumption that every `/dev` device is benign.
- Sensitive binds such as `/`, `/etc`, `/proc`, `/sys`, `/dev`, runtime state,
  Docker storage, root/home credentials, and their ancestors; inspect source paths,
  long-form bind options/propagation, and both read-only and writable exposure.
- `cap_add` (notably ALL/SYS_ADMIN/SYS_PTRACE), security-option relaxation, host
  namespace/cgroup settings, and privileged hooks are other host-control signals.
- Named volumes are not intrinsically safe: inspect `driver_opts` (including bind
  indirection), custom drivers, externally managed volumes, and `volumes_from`.

**Conservative proposal:** reject unresolved interpolation in safety-relevant values,
external `include`/`extends`, uninspectable file references, builds requiring external
context, and unknown host-affecting constructs until their semantics can be inspected.
Inspect all services, including profile-disabled ones, plus referenced extension/anchor
content; retain field/service paths in disclosures. Ordinary ports, ordinary networks,
and plain app-scoped named volumes need not be classified as elevated solely for existing.
Do not read host files or execute Docker Compose to resolve uncertainty.

Limits: local YAML parsing cannot establish symlink targets, remote host paths, mutable
external volumes, image behavior, or the exact ZimaOS Compose engine/schema version.
Safety analysis is a conservative guardrail, not proof that arbitrary Compose is safe.
The allow/reject boundary and numeric resource budgets need manager review and tests.

### C. Current official MCP v2 facts

Verified 2026-09-27 against the official TypeScript SDK repository at
`7f7a94c22017e121a960e071bb50ec75e34450bd`, official spec repository at
`ab3a39c13bd23be691c2760e1c6c5c15a64582e1`, npm registry metadata, and the
published server 2.1.0 declaration bundle (research download, not installed in product).
Sources:

- Stable status: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- Releases: https://github.com/modelcontextprotocol/typescript-sdk/releases
- Package metadata: https://registry.npmjs.org/@modelcontextprotocol/server
  (also `/@modelcontextprotocol/client`, `/@modelcontextprotocol/node`,
  `/@modelcontextprotocol/core`, `/@modelcontextprotocol/server-legacy`, and `/@modelcontextprotocol/sdk`).
- Upgrade: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- Protocol migration: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- Versions: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
- HTTP: https://ts.sdk.modelcontextprotocol.io/v2/serving/http
- Legacy: https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients
- State/session distinction: https://ts.sdk.modelcontextprotocol.io/v2/serving/sessions-state-scaling
- Input required: https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required
- Codec source:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/7f7a94c22017e121a960e071bb50ec75e34450bd/packages/server/src/server/requestStateCodec.ts
- Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- HTTP spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- Elicitation spec: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation

#### Releases, packages, and runtime

The official README explicitly identifies **v2 as the stable release line**, released
alongside MCP **2026-07-28**. v1 receives fixes/security updates for at least six months
after v2 release. Registry `latest` is **2.1.0** for `@modelcontextprotocol/server`,
`@modelcontextprotocol/client`, `@modelcontextprotocol/node`, `@modelcontextprotocol/core`,
and `@modelcontextprotocol/server-legacy`. The old monolithic `@modelcontextprotocol/sdk`
remains **1.30.1**: changing only its version range is not a v2 migration.

Use server + node for the existing `node:http` runtime, client for test clients.
`@modelcontextprotocol/core` holds public Zod wire-schema constants only if needed;
types/error classes are re-exported by server/client. Do not import `core-internal`.
Optional Express/Fastify/Hono adapters exist but are unnecessary here.
v2 requires **Node >=20**, is ESM-first with a CommonJS build, and supports Standard
Schema (including existing Zod 4). Retain the project's Node >=22/LTS direction;
use `z.object(...)`, not the existing raw schema shapes. The state codec uses Web Crypto.
Registry packages declare MIT; repository LICENSE records a transition: new code
Apache-2.0, un-relicensed existing code MIT, non-spec docs CC-BY-4.0. Retain notices;
these code licenses are compatible with this Apache-2.0 project. No upstream docs/code
are being vendored into runtime by this checkpoint.

#### Handler, transport, and protocol behavior

- `McpServer` and `createMcpHandler(factory)` come from `@modelcontextprotocol/server`.
  The factory creates a fresh server per HTTP request, receiving `era`, `authInfo`,
  and `requestInfo`. The handler exposes `fetch`, `close`, `notify`, `bus`.
- `toNodeHandler(handler)` comes from `@modelcontextprotocol/node` and adapts to
  `IncomingMessage`/`ServerResponse`. It replaces this repo's manual fresh v1
  `StreamableHTTPServerTransport` + `connect` + response-cleanup wiring.
- Modern 2026-07-28 has `server/discover`, per-request `_meta` protocol/capability
  envelopes, no `initialize` handshake or `Mcp-Session-Id`, and no standalone GET
  notification stream. It uses in-band MRTR instead of server-initiated requests.
  Stateless transport does not prohibit application-side replay protection.
- Legacy era spans 2024-10-07 through 2025-11-25. `createMcpHandler` defaults to
  `legacy: 'stateless'`; `legacy: 'reject'` refuses legacy requests. Legacy GET/DELETE
  session operations return 405. Sessionful legacy deployment needs separate routing
  and transport/session storage; not a free feature of the new handler.
- v2 clients still default to **legacy** negotiation. `versionNegotiation: { mode: 'auto' }`
  probes modern then falls back; `{ mode: { pin: '2026-07-28' } }` requires modern.
  Merely upgrading a client package does not activate the new protocol.
- Old HTTP+SSE is not the modern server transport. Frozen deprecated server SSE exists
  in `@modelcontextprotocol/server-legacy/sse`; no need to add it to this project.
- `InMemoryTransport` tests exercise legacy instances. Modern tests should drive
  `createMcpHandler.fetch` through a `StreamableHTTPClientTransport` custom fetch,
  plus real Node HTTP tests for auth, body limits, and header behavior.

The handler does **not** authenticate bearer tokens or validate Host/Origin for the
application. Preserve auth before every `/mcp` request, including discovery/retries;
pass only verified identity via `authInfo` (`ctx.http.authInfo` in handlers). Preserve
the bounded body reader, `/health`, shutdown, normalized errors, and secret-free logging.
Add explicit deployment-appropriate Host/Origin checks: localhost-only helpers are not
an automatic LAN policy. Modern requests require `MCP-Protocol-Version`, `Mcp-Method`,
and applicable `Mcp-Name` headers; proxies/CORS must allow them and body/header checks
must remain SDK-owned. Do not project Compose or credentials into `Mcp-Param-*` headers.
The existing deployment bearer contract is not a claim of full MCP OAuth discovery
compliance, and client-supplied `clientInfo` is not authenticated identity.

#### Native input-required and integrity protection

`inputRequired`, `inputRequired.elicit`, `acceptedContent`, `inputResponse`, and
`createRequestStateCodec` are verified server package APIs (also present in published
2.1.0 declarations). A handler returns `InputRequiredResult`, not a pending push request:
`resultType: 'input_required'`, an `inputRequests` map, and optional `requestState`.
The modern client answers the form and retries with a fresh JSON-RPC id, original
arguments, latest-round `inputResponses`, and the exact opaque state string.
Read replies via `ctx.mcpReq.inputResponses`; validate with
`acceptedContent(responses, key, schema)` (the schema-less overload does not validate).
Use `inputResponse` to distinguish decline/cancel/missing. Form schemas are restricted
flat primitive objects; a required boolean with no affirmative default fits.

Form elicitation requires declared `elicitation.form` support (legacy empty
`elicitation: {}` also denotes form support). Modern capability declarations live in
`_meta.io.modelcontextprotocol/clientCapabilities` on **each request**; SDK checks
embedded requests and refuses missing capability (`-32021`, normally HTTP 400).
Old `ctx.mcpReq.elicitInput` throws on modern connections. The legacy shim can turn
`input_required` into push `elicitation/create` on a suitable live legacy connection;
this is not proof that stateless legacy HTTP can complete approval. Its re-entry may
occur within the originating request, unlike modern independent retries.

`requestState` is attacker-controlled unless protected. Official opt-in API:
`createRequestStateCodec({ key, ttlSeconds, bind })` returns `{ mint, verify }`.
Configure `new McpServer(info, { requestState: { verify: codec.verify } })`;
`ctx.mcpReq.requestState<T>()` then reads the verified decoded payload.
`mint(payload, ctx)` requires context when `bind` is set. Key length is at least
32 bytes; default TTL is 600 seconds; `bind(ctx)` is evaluated at mint and verify
(e.g. authenticated principal plus `ctx.mcpReq.method`). Bad/expired state is rejected
before handler entry with `-32602`. HMAC-SHA256 provides integrity, **not encryption**.
No automatic argument/risk binding or one-time consumption is supplied: the application
must implement them. The MRTR spec explicitly requires server-side enforcement for
at-most-once state consumption; a signature plus expiry only bounds replay.

### C. Concrete risky-install approval proposal — manager review required

This is the implementation design, **not implemented or client-tested behavior**:

1. Keep Phase 1/read and eligible benign tools available to legacy stateless clients.
   Require **modern 2026-07-28 plus form elicitation** for risky installs. Reject risky
   legacy calls without mutation; do not silently use the push shim to weaken the
   first-request boundary. Disable the legacy input-required shim for provisioning.
2. Authenticate, check install permission, bound/parse/analyze the exact Compose string,
   and perform read-only collision checks. No real install on this entry, even if the
   client supplies unsolicited `confirm`/`inputResponses`. Without a valid issued
   pending challenge, supplied answers cannot authorize anything.
3. Return native `inputRequired` with `inputRequired.elicit`: disclose operation,
   exact-content SHA-256 fingerprint, detected categories/field paths/explanations,
   and expiry in the message, with a compact structured risk manifest alongside
   human-readable explanations. The verified `inputRequired` builder accepts only
   `inputRequests` and `requestState`; do not invent a `structuredContent`/`_meta`
   builder option. Final client rendering of the disclosure needs acceptance testing.
   The required approval boolean has no true default. Mint only **awaiting-approval**
   state, never an already-approved claim.
4. Signed payload binds schema/policy version, random challenge id, exact original
   UTF-8 Compose fingerprint, tool `install_app_from_compose`, upstream install intent
   (target host identity and fixed options), intended app name, normalized risk set and
   disclosure digest. Codec expiry: proposed **300 seconds**. Bind codec context to
   authenticated deployment principal and method `tools/call`; compare tool/content/
   options/disclosure fields explicitly on re-entry. Do not use JSON-RPC id as the
   continuation key because retries require a new id. Do not place YAML, secrets, or
   sensitive literal values in the signed-but-readable token or disclosure.
5. Keep a bounded process-wide pending/consumed challenge ledger, independent of fresh
   MCP instances. Generate a separate ephemeral signing key at process startup, never
   from the MCP or ZimaOS credential. Restart loses pending state and rotates the key,
   invalidating outstanding approvals. This proposes single-process deployment, not
   database/shared-state infrastructure; multi-replica approval remains unsupported
   unless atomic shared consumption and key distribution are designed later.
6. On the later modern request, verify state, pending ledger entry, expiry, exact
   content/options, authenticated principal, and unchanged risk/disclosure policy.
   Recheck permission, locally analyze again, and require a schema-valid accepted
   `confirm === true` response under the issued challenge key. Decline/cancel/invalid/
   missing/expired/mismatched state fails closed; changed Compose requires fresh
   disclosure. Never turn validation errors into approval prompts.
7. Under an install lock, recheck collisions and upstream dry-run/port conflict, then
   atomically consume the challenge **before** sending at most one real POST with the
   exact original string. Failed/uncertain POSTs never automatically retry or restore
   approval. Report async acceptance separately from completed installation; reconcile
   with read tools and bounded polling, without guessing a returned app id.

**Human-enforcement limit:** the protocol requires clients to provide a user interface,
but server/SDK mechanics cannot cryptographically prove that a human clicked approval.
A capable agent/client can answer the elicitation automatically; the SDK's modern client
even auto-drives rounds using registered handlers by default. Signing proves server-issued
intent and tamper resistance, not human presence or actual viewing of a disclosure. The
client must guarantee the human UI stop; document and test the chosen client before
Phase 2 acceptance. Missing reliable interaction support must fail closed.

### C. Phase 2D implementation verification (2026-09-30)

Official SDK source/declarations and protocol references above remain the source of
the MCP mechanics. Installed `@modelcontextprotocol/server` v2 exposes
`inputRequired.elicit`, `acceptedContent`, `createRequestStateCodec`,
`ServerOptions.requestState.verify` and `inputRequired.legacyShim: false`.
The SDK requires `elicitation.form` in the modern request's client capabilities;
without it a native input-required response fails with a capability error. The
modern client configured with pinned `2026-07-28` and manual input fulfillment
was exercised through authenticated local HTTP, including signed first-round
state, accepted continuation, replay rejection, and negative continuations.
These are **mocked ZimaOS** round trips, not VM or human-UI verification.

Implementation consequence: a single process-wide ledger prevents replay
across per-request MCP server instances; the ephemeral HMAC key is shared
across those instances for one HTTP server lifecycle. A signed-but-readable
state carries only digests and the intended app name, never source YAML or
credentials. The transport authenticates before invoking the SDK. Legacy risky
requests fail closed; no legacy elicitation shim authorizes them. The client
still controls whether it actually pauses for a human: MCP cannot prove that.

### D. ZimaOS provisioning: official/package facts

The existing scratch `app_management.yaml` was inspected for lifecycle paths and
query definitions, not treated as independently authenticated upstream provenance.
Its relevant operation shapes were cross-checked against the official published
`@icewhale/casaos-appmanagement-openapi@0.4.17-alpha1` (registry latest at research
time, Apache-2.0), whose `dist/api.js` and declarations were downloaded only to scratch:

- https://registry.npmjs.org/@icewhale/casaos-appmanagement-openapi
- https://www.npmjs.com/package/@icewhale/casaos-appmanagement-openapi/v/0.4.17-alpha1
- https://registry.npmjs.org/@icewhale/casaos-appmanagement-openapi/-/casaos-appmanagement-openapi-0.4.17-alpha1.tgz

The documented base remains `/v2/app_management` (see Phase 1 sources above).
Verified package operation shapes:

| Operation             | Method/path            | Request and meaning                                                                                              |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `installComposeApp`   | `POST /compose`        | `application/yaml` body, `dry_run`, `check_port_conflict`, `uncontrolled` query options; dry-run validates only  |
| `uninstallComposeApp` | `DELETE /compose/{id}` | encoded stable id and optional `delete_config_folder`; no request body                                           |
| `updateComposeApp`    | `PATCH /compose/{id}`  | encoded stable id, optional `force`; no request body; specifically update to latest App Store app version/images |

Do not mistake `PUT /compose/{id}` (apply settings/arbitrary Compose change) for the
approved update tool; general settings mutation remains excluded. The scratch spec
declares defaults `dry_run=false`, `check_port_conflict=true`, `force=false`, and
`delete_config_folder=true`. Never inherit a destructive delete default silently:
proposed product policy is explicit `delete_config_folder=false` unless separately
reviewed data-deletion semantics are deliberately exposed. Acceptance of a flag does
not prove which files/volumes it removes or preserves.
`uncontrolled` is marked deprecated/unused at the install parameter reference in
scratch but retains a version-control description elsewhere: exact live semantics
remain unresolved; do not expose it as a safety bypass.

### D. Phase 2E DELETE implementation (mocked; 2026-09-30)

The official published `@icewhale/casaos-appmanagement-openapi@0.4.17-alpha1`
operation `uninstallComposeApp` above supplies the DELETE path, encoded id,
optional `delete_config_folder` query, and lack of request body. The earlier
manager-supplied ZimaOS v1.7.1 observation recorded HTTP 200 asynchronous
acceptance and 404 for missing ids. Neither source proves storage retention for
`false` or that a 200 means removal has finished. Accordingly the client sends
an explicit `delete_config_folder=false`, normalizes fixed-shape acceptance,
and never retries a DELETE. The service checks an exact listed app id and
allows only one bounded read-only list observation after acceptance; a stale
listing reports pending rather than triggering a second DELETE. These are
mocked local results pending live MCP acceptance, not a new live API probe.

### Live Phase 2 response-shape correction (2026-09-30)

On the authorized disposable ZimaOS v1.7.1 VM, a fresh benign disposable
Compose app was installed once and removed once with explicit
`delete_config_folder=false`; read-only app-list observations confirmed its
appearance and disappearance, returning to the existing baseline. Both real
operations returned **HTTP 200 with only a `message` string** (no `success`
or `data` key). The install and uninstall messages were respectively 37 and
39 characters, consistent with the previously documented fixed asynchronous
acceptance phrases. No raw messages or credentials were logged. A strict
`success:true`-only normalizer therefore wrongly returned `upstream_error`
even though both operations took effect. The runtime now recognizes only the
verified fixed async phrase for the matching operation on message-only HTTP
200, retaining ambiguous treatment for other text, empty/non-JSON responses,
and 5xx. A second benign disposable app exercised the corrected production
image through MCP: both install and uninstall returned `accepted` and read-only
listing confirmed appearance then removal. An accepted response remains
asynchronous, not proof of completion.

### D. Live ZimaOS v1.7.1 facts — manager-provided evidence, not new tests

These facts were supplied as independently/manual verified evidence for this recovery
checkpoint. They supersede ambiguous earlier chat reasoning; no lifecycle probe was
rerun. Existing `probe*_results.jsonl` files were inspected structurally and by numeric
HTTP-status aggregates without printing payloads. They are incomplete history (for
example the first result file does not contain the later manager-confirmed 502 case),
not a reason to discard the deterministic later observations below.

1. Valid `POST /v2/app_management/compose?dry_run=true`: **200**, validation-only /
   installation-skipped message; no install.
2. Malformed YAML: **400**.
3. Schema-invalid but syntactically valid `services: { web: 123 }`, dry-run: **502**.
   A valid minimal Compose immediately afterward returned **200** and the app list was
   unchanged. Do not describe every 502 as server outage or every invalid schema as 4xx;
   reject this structure locally and preserve the upstream error distinction.
4. Occupied host port with `check_port_conflict=true`: **400**, `data.ports_in_use`.
   With `false`, the same dry-run can return **200**. Proposed product behavior keeps
   port checking explicitly enabled on validation and installation.
5. Real install: **200**, "app is being installed asynchronously". Acceptance is not
   completion; a named Compose can use its name as the app id, but this is not guaranteed.
6. Deterministic duplicate: first `name: p2dup927` installed as `p2dup927`, `running(1)`.
   Posting the **exact same Compose again** returned **200 async** and created a second
   app, `compose-a7eb993dfeef8433`. Install POST is **not idempotent**, does not imply
   reconciliation, and must not be retried blindly.
7. DELETE: **200 async**; after completion the app is absent from list and detail is
   **404**. Both `delete_config_folder=true` and `false` were accepted. Exact storage
   retention/destruction effects were not established by these observations alone.
8. DELETE/PATCH missing app: **404**.
9. PATCH non-store app: **200**, "app '<id>' is up to date". This establishes a response
   on that fixture, **not** App Store update/version-transition semantics or completion.
10. Both duplicate-test apps were deleted with `delete_config_folder=true`. Final
    manager-verified baseline: **only `mcp-test-nginx`**, no Phase 2 probe-created app.

### D. Permissions and duplicate-name policy

Final configuration naming decision for future implementation:

| Variable              | Default | Sole mutation scope                                                   |
| --------------------- | ------- | --------------------------------------------------------------------- |
| `ALLOW_APP_CONTROL`   | `false` | existing start/stop/restart only                                      |
| `ALLOW_APP_INSTALL`   | `false` | `install_app_from_compose`, still subject to safety/approval          |
| `ALLOW_APP_UNINSTALL` | `false` | `uninstall_app` only                                                  |
| `ALLOW_APP_UPDATE`    | `false` | verified `update_app` only; permission does not establish API support |

Validate explicit booleans at startup. No flag grants another permission; check at
execution and again on approval continuation. `validate_app_compose` is non-mutating
and does not require install permission or grant it. No `ALLOW_UNSAFE_COMPOSE` or
equivalent global/permanent bypass exists in the design.

For named installs, list current apps before issuing a challenge and again immediately
before POST. Compare candidate name with existing app ids and available Compose/project
names; ambiguous names/identities or failed enumeration are not a clean preflight.
Any collision returns an explicit conflict, without POST, even for identical content
or stopped apps. Never silently convert install to PATCH/PUT, delete/reinstall, or
generate a replacement name. Serialize/reserve in-flight installs locally so async
acceptance/list lag cannot permit a second POST; uncertain outcomes require read-only
reconciliation, not automatic retry (including generic HTTP-client retries).

**Limit/proposal for review:** upstream provides no verified atomic create-if-absent
or idempotency key. Local locks cannot prevent concurrent external UI/API changes.
Require an explicit, statically inspectable top-level Compose name for install until
unnamed/metadata-derived identity can be handled safely; validation may still accept
unnamed documents. Do not insert or rewrite a name. Exact name aliases/normalization
and reservation lifetime must be covered by implementation tests, not inferred from
the one observed name-to-id mapping.

### Unresolved items / implementation gates

- Manager review of the proposed modern-only risky-install client contract, 300-second
  single-use ledger, single-process scope, explicit-name requirement, and conservative
  unsupported-Compose boundary. No target client's human UI/modern MRTR support was tested.
- Precise parser resource budgets, supported Compose schema subset, interpolation,
  alias/merge edge-case parity with the ZimaOS engine, and collision normalization.
- Real App Store update transitions, force behavior, version identity, async/failure
  semantics, and a deterministic safe fixture remain unverified. Keep `update_app`
  blocked until verified; a non-store "up to date" result is insufficient. Do not
  expand into App Store search/registration to resolve it automatically.
- Uninstall data-retention boundaries and deprecated `uncontrolled` semantics remain
  unverified. Avoid exposing destructive retention options or unsupported install knobs.
- Install/delete completion polling needs bounded policy and normalized timeout/unknown
  outcomes. No safe automatic retry can be inferred from 200 async or transport failure.
- No fresh live verification, SDK integration test, runtime implementation, or Phase 2
  acceptance claim was made by this research pass. All are later approved work.

## Phase 4 image-access audit (2026-10-01)

- GitHub's official [Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
  was retrieved directly: public container images support anonymous pulls and
  package permissions can be independent of repository permissions. Private
  registry authentication requires appropriate package access; publication alone
  does not imply public visibility.
- Fresh GitHub repository metadata reports `PRIVATE`. The package metadata API
  (`GET /users/lvgvs/packages/container/zimaos-mcp-server`) returned HTTP 403,
  explicitly requiring `read:packages`. Exact current package visibility is
  therefore **unverified**, not inferred from repository visibility.
- An anonymous pull-scoped request to GHCR's token endpoint for
  `lvgvs/zimaos-mcp-server` returned HTTP 401. This verifies anonymous access is
  currently denied from the audit environment; it is not package-visibility metadata.
  No registry token or credential was emitted.
- No supported ZimaOS Custom App UI registry-authentication flow was verified.
  Official Docker-app publishing documentation retrieval was blocked (403), and
  a community search result suggests a CLI workaround, which is not an approved
  normal-user installation path or authoritative product requirement.
- **Implication:** stop before fresh-install UAT for the manager's image-access
  decision. Public package access and source-repository visibility are separate
  decisions. Do not change visibility, introduce a permanent PAT deployment
  requirement, or substitute host-side Docker/SSH workarounds.

## Phase 3A — existing-app Compose API (2026-10-01)

**Official boundary:** IceWhaleTech's Apache-2.0 `CasaOS-AppManagement` OpenAPI at
[`debfa317`](https://github.com/IceWhaleTech/CasaOS-AppManagement/blob/debfa317f0f996b91b43210e8d57799461388704/api/app_management/openapi.yaml#L449-L497)
defines `GET /compose/{id}` (`Accept: application/yaml` yields **interpolated** YAML)
and `PUT /compose/{id}` (`application/yaml` exact request body; `dry_run`,
`check_port_conflict`, optional `uncontrolled`). Its 200 apply response is only
`BaseResponse`; 400/404/500 are specified. The official published Apache-2.0
`@icewhale/casaos-appmanagement-openapi@0.4.17-alpha1` contains the same
`myComposeApp` and `applyComposeAppSettings` operations. These are approved,
documented operations, **not** internal endpoint discoveries. `PATCH /compose/{id}`
is a different App Store image-update operation and remains outside Phase 3.
Authenticated requests use the already verified login bearer session. No official
compare-and-swap header, version parameter, explicit rollback endpoint, or raw
uninterpolated installed-app Compose read is specified here. A process-local lock
cannot prevent an external actor from writing between the last GET and PUT.

**Live matrix:** disposable ZimaOS v1.7.1, dedicated `p3-repair-probe-1001` nginx
fixture, removed afterward. Probes used the official endpoints only; HTTP status,
envelope keys, counts and digests were printed, never source bodies or tokens.

| Case                                              | Observed result / implication                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `GET` JSON / YAML                        | 200 JSON `{data:{compose,status,store_info},message}`; `compose` is an object. YAML returns `text/plain; charset=UTF-8`, interpolated/reformatted content. Exact posted bytes **did not** match the returned YAML even immediately after install or apply. Fingerprint the authoritative **returned representation**, not the posted source, and do not infer source equality from its digest. |
| Missing `GET`, unauthenticated `GET`              | 404 `{message}` for both JSON/YAML; 401 `{message}` without bearer. 403, 429 and 5xx could not be safely forced on read.                                                                                                                                                                                                                                                                       |
| Existing `PUT` dry-run                            | `?dry_run=true&check_port_conflict=true` returned 200 `{message}` for valid exact YAML; no mutation. Malformed YAML: 400 `{message}`; schema-invalid service scalar: empty 502; occupied port 80: 400 with `data.ports_in_use`; absent id: 404; unauthenticated: 401. No raw upstream message should reach MCP clients.                                                                        |
| Project-name mismatch in dry-run                  | **200** despite changed top-level `name`. Product must check identity locally; upstream dry-run is not an identity safeguard. A real mismatched PUT was deliberately not sent.                                                                                                                                                                                                                 |
| Real `PUT` env/config and port                    | `?dry_run=false&check_port_conflict=true` each returned 200 `{message}`; subsequent YAML GET observed the changed marker or benign published port 18977 on first two-second observation. GET source was reformatted; container API returned 200 after each. This establishes visible post-apply state, **not** synchronous completion or container recreation details.                         |
| Real invalid Compose                              | The service-scalar invalid document returned empty 502. Three seconds later the existing YAML digest and app-list ids were unchanged. This one failure **does not prove rollback**; it may have failed before any mutation.                                                                                                                                                                    |
| Existing self-port / real occupied-port rejection | Unchanged YAML from an app already publishing a host port passed PUT dry-run with `check_port_conflict=true`; the check does not reject its own port. A real PUT to occupied host port 80 returned 400 with `data.ports_in_use`; three seconds later the fixture's YAML digest was unchanged. This does not prove restoration after a partial apply.                                           |
| Concurrent conflicting real PUTs                  | Two simultaneous edits to the same dedicated fixture, both based on the same read, each returned 200 `{message}`; after bounded read-only observation one candidate's environment marker won. No conflict response/CAS was observed. The product must serialize its own writes and recheck the base, but cannot guarantee safety against concurrent external writers.                          |
| Fixture cleanup                                   | Official DELETE with `delete_config_folder=false` returned 200 `{message}`; app disappeared from read-only list on first two-second poll. Only pre-existing `mcp-test-nginx` remained.                                                                                                                                                                                                         |

**Unresolved / conservative implementation boundary:** No explicit supported
rollback API or reliable rollback guarantee has been verified. An invalid PUT
leaving the old configuration visible is not evidence that every partially applied
edit can be restored. A second actual mutation must not be issued as an automatic
"rollback" after an uncertain first attempt. The OpenAPI contains no atomic
conditional-write primitive, and live conflicting PUTs both succeeded. Concurrent
external writes cannot be made impossible with process-local optimistic concurrency;
document this residual race. The
read representation may interpolate environment values and thus contain app
secrets: do not log it or upstream error messages, and do not use the MCP server's
own Compose as an acceptance fixture.

### Phase 3 live MCP acceptance and async response (2026-10-01)

Two disposable characterization runs used a dedicated `p3-edit-acceptance`
nginx application on ZimaOS v1.7.1; each run installed and deleted it via the
official APIs, and read-only enumeration confirmed the baseline returned to
only `mcp-test-nginx`.
The authenticated MCP product read its interpolated YAML and 64-character
fingerprint, validated without mutation, rejected the default-off edit, invalid
YAML, wrong project name and stale fingerprint, and applied benign environment,
published-loopback-port and restart-policy changes. The GET fingerprint changed
after each HTTP-200 PUT; `get_app_health` reported healthy, one container was
listed and logs were accessible. Immediately after the last edit the list/detail
status still read `created` while the health probe was healthy: no synchronous
completion or container-recreation guarantee follows from that status alone.
Modern risky first-round elicitation produced a signed request state without a
real risky mutation; actual privileged continuation was deliberately not tested
against the VM. Automated local HTTP tests cover accepted continuation and replay.

The **real existing-app PUT** returned HTTP 200 with the exact, fixed message
`app is being applied with changes asynchronously` (three observations). The
initial generic install response normalizer marked this message `upstream_error`
even though subsequent GETs changed. Existing-app response handling now
recognizes **only** this verified message-only 200 envelope as `accepted`;
other unknown 200 messages remain uncertain. Acceptance does not prove apply
completion. The official OpenAPI source and version pinned above remain the
authority for the endpoint; this live finding only constrains its response
normalization.

A third, bounded closing run used a fresh `p3-edit-close-1001` fixture and the
corrected MCP server. A single benign environment-value edit returned
`accepted` with a changed read-only observation; a subsequent GET contained
the requested value. The dry run left the original fingerprint unchanged,
default-off permission denied mutation, a stale base was rejected, and a
privileged candidate yielded modern input-required without mutation. Fixture
removal was accepted and read-only enumeration again showed only
`mcp-test-nginx`, whose health probe was healthy. This did not test privileged
approval continuation, explicit rollback, or a human client's disclosure UI.

**Phase 3E recovery conclusion:** No official explicit rollback API or reliable
partial-failure recovery guarantee was found in the OpenAPI, package or live
tests. The product offers bounded read-only reconciliation after a single PUT,
not rollback, `.bak` access, host-file writes or automatic retry. An ambiguous
response remains uncertain even if a subsequent GET is unchanged; an observed
changed fingerprint is not proof that the candidate has completed successfully.

## Pre-public GitHub history-retention boundary (2026-10-01)

Historical finding: the manager subsequently approved a distinct canonical-repository migration
rather than an in-place remote rewrite. The original private PR refs remain preservation-only.

- Authoritative source: [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
  GitHub marks `refs/pull/*` read-only; a branch-history rewrite cannot update those
  internal refs. Old data can remain accessible through PRs and cached SHA views.
  GitHub describes Support-assisted PR dereferencing, cache removal and server garbage
  collection, but explicitly says Support will not remove non-sensitive data and applies
  its own sensitive-data criteria. Do not promise that personal-email cleanup qualifies.
- Live read-only evidence: remote ref enumeration found open-PR heads/merge refs and
  closed PR #3's head. The closed PR is unmerged; its fetched history reaches seven
  commits containing the personal email in metadata. No private email value is recorded.
- Implication: the locally verified branch rewrite alone is not proof of complete
  pre-public privacy sanitization. Stop before remote replacement for a manager decision
  on GitHub-managed history retention; do not delete PRs, recreate the repository,
  change visibility or contact Support without approval.

## Canonical repository migration / GHCR identity boundary (2026-10-01)

- Read-back verification: the renamed private historical repository retained GitHub numeric ID
  `1388638620` and its original main. The new empty private canonical repository has distinct ID
  `1400704911`. A normal `main` push imported 48 sanitized commits; independent clone/scan verified
  the initial tree and history. No old backup/candidate/PR ref was pushed.
- Authoritative source: [GitHub Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
  Package linkage/access is separate from the image's namespace. GitHub recommends
  `org.opencontainers.image.source` for repository association; linked repositories can inherit
  Actions package access. An unchanged repository name does not establish unchanged repository ID.
  The runtime Dockerfile now labels the canonical source URL explicitly.
- New-repository workflow evidence at initial import: GHCR login and image build succeeded;
  tag publication failed with `permission_denied: write_package`. Available API credentials still
  cannot read package visibility, linked repository or versions (`read:packages` required, HTTP 403).
  Do not infer current linkage, visibility or stale-image cleanup from those failures.
- Implication: an owner must inspect package settings and grant the new repository Actions write
  access to the existing package, then verify/relink its canonical source as appropriate. No new
  package name, personal-token workaround, visibility change or package-version deletion is needed.
  Preserve the historical repository unarchived until linkage/access migration is resolved.
