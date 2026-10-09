# Decisions

Architectural decisions made during implementation and approved-scope research. Routine
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

## 2026-09-26 — Dockerfile: no external BuildKit frontend (`# syntax=` directive removed)

**Decision:** The committed `Dockerfile` does not use a `# syntax=docker/dockerfile:1`
directive; it builds with the daemon's built-in BuildKit frontend only.

**Reason:** The Hermes environment resolves Docker Hub to IPv6 addresses without working IPv6
egress, so fetching the external `docker/dockerfile:1` frontend image fails at build step 0 even
though ordinary image pulls (IPv4) succeed. The Dockerfile uses only built-in-frontend features
(multi-stage, `COPY --from`, `--chown`, `HEALTHCHECK`), so removing the directive is behaviorally
neutral and makes the production image buildable in this environment without any daemon config
change.

**Rejected alternative:** Keep the directive and configure a BuildKit/daemon IPv4 workaround —
more moving parts, and no frontend-only feature is used or planned for Phase 1.

## 2026-09-27 — Phase 2 parser and exact-content preservation

**Decision:** Select `yaml@2.9.1` (ISC) for bounded local YAML AST/Map inspection,
with explicit core-schema/merge support and strict error/warning rejection as described
in `docs/RESEARCH.md`. Do not add a product dependency during this research checkpoint.
Inspect parsed data but fingerprint and submit the exact original UTF-8 Compose string;
never canonicalize/reserialize it for approval or installation.

**Reason:** Official APIs plus 14 passing synthetic checks verify inspectable data,
merge resolution, duplicate-key detection, and alias limits. ISC is compatible with
Apache-2.0 original source with its notice retained. Maps avoid prototype-property
assignment; separate cycle, duplicate-merge, type, and resource checks remain necessary.

**Rejected alternative:** Default parser options or the old scratch probe as a safety
boundary. That probe fails and does not cover those protections. YAML syntax success
is not Compose schema validation or proof of safe host behavior.

## 2026-09-27 — Migrate Phase 2 to stable MCP SDK v2 / modern HTTP

**Decision:** Follow manager direction to migrate from `@modelcontextprotocol/sdk`
1.30.1 to the official split v2 packages, researched at 2.1.0: server + node for
runtime, client for tests. Use `createMcpHandler` and `toNodeHandler` for modern
2026-07-28 requests while retaining stateless legacy compatibility for Phase 1 behavior.
This is a future migration decision; no dependency/source/test changes in this checkpoint.

**Reason:** Current official README, release metadata, specification, and published APIs
verify stable v2, per-request HTTP, native input-required continuation, and an official
integrity-protected state codec. Existing Zod 4 and Node >=22 fit v2's requirements.

**Rejected alternative:** Inventing v2 APIs or retaining v1 solely to avoid migration.
The current per-request v1 architecture already maps naturally to the handler factory.

## 2026-09-27 — Approval security invariants and native continuation

**Decision:** Use native modern `input_required` form elicitation plus signed,
short-lived `requestState`, bound to exact Compose content, operation, deployment
principal/target, options, and disclosed risks. Require server-side single-use
challenge consumption; signing alone is insufficient. First risky request never
mutates, and unsolicited answers without issued pending state never authorize.
Unsupported clients fail closed; no permanent unsafe bypass.

**Reason:** Official MRTR spec and `createRequestStateCodec` support integrity/expiry,
but explicitly leave at-most-once enforcement to the server. Client assertions cannot
prove human presence; manager review of that enforcement limit is required by PROJECT.md.

**Review boundary:** The concrete 300-second, ephemeral-key, single-process ledger and
modern-only risky-install proposal is in `docs/RESEARCH.md`; manager review and client
verification are required before implementation/acceptance. Legacy Phase 1 compatibility
does not imply legacy risky-install approval support.

## 2026-09-27 — Separate default-off provisioning permissions

**Decision:** Reserve `ALLOW_APP_INSTALL`, `ALLOW_APP_UNINSTALL`, and `ALLOW_APP_UPDATE`
as independent, startup-validated booleans defaulting to false. `ALLOW_APP_CONTROL`
continues to authorize only start/stop/restart. Validation grants no mutation authority.
Install permission never bypasses risk approval; no `ALLOW_UNSAFE_COMPOSE` equivalent.

**Reason:** PROJECT.md requires separate authority for materially different operations;
the existing permission layer only controls the three reversible Phase 1 actions.
An update flag does not authorize implementing unverified update semantics.

## 2026-09-27 — Named install conflicts fail closed; POST is not idempotent

**Decision:** Preflight current app ids/names and repeat the check before installation.
Return an explicit conflict on any existing/ambiguous candidate, regardless of content
equality. Reserve/serialize local in-flight installs; do not blindly repeat an accepted
or uncertain POST, silently rename, or reinterpret install as update.

**Reason:** Manager's deterministic v1.7.1 reproduction installed `p2dup927` and then,
from identical YAML, a second `compose-a7eb993dfeef8433` app. A 200 async response is
not an idempotency guarantee. No atomic upstream create-if-absent contract is verified.

**Review boundary:** Requiring explicit names until unnamed identity is safely handled,
and the remaining external-writer race/async reconciliation limits, are documented
proposals rather than claims of complete duplicate prevention.

## 2026-09-30 — Modern risky approval is process-local and single-use

**Decision:** Implement the already-approved native `input_required` flow with
300-second HMAC-signed exact-content request state, an independent bounded
process-wide challenge ledger, and a process-wide install lock. Recheck the
approved intent and upstream dry run before consuming the challenge and sending
at most one real POST. Reject risky legacy clients rather than using the SDK's
push-style legacy elicitation shim.

**Reason:** The HTTP handler creates an MCP server per request, so signed state
alone cannot prevent replay across rounds. A process-local ledger provides atomic
single-use consumption under the existing install lock without adding shared
storage. Its ephemeral key and pending state intentionally die on restart;
multi-replica approval would need a separate atomic shared-state design.

**Limit:** Native elicitation and server-side signing cannot attest that the
client displayed the disclosure to a human. Client-side human-UI behavior
requires separate acceptance verification; no global approval bypass is added.

## 2026-10-01 — Phase 3: existing-app Compose configuration and repair

**Decision:** Authorize Phase 3 as **App Configuration & Repair**. The product may add supported
ZimaOS-API-based read/validate/edit capabilities for an already-installed application's Compose,
but only after Phase 3A verifies the exact current read/apply/error/async/rollback semantics against
official sources and the authorized disposable VM.

Safe edit design direction:

- read current Compose and derive a stable base fingerprint;
- require optimistic-concurrency/base-fingerprint matching before mutation;
- preserve exact proposed UTF-8 Compose content across validation, approval, and apply;
- preserve app/project identity rather than turning edit into rename/recreate;
- compute current/proposed **risk delta**, distinguishing unchanged/removed risk from
  newly introduced or escalated risk;
- gate mutation behind an independent default-off `ALLOW_APP_EDIT`;
- serialize/recheck the target app immediately before mutation;
- perform at most one real apply mutation and never automatically retry an ambiguous outcome;
- reuse/generalize the approved modern Phase 2 single-use risky-approval flow for newly
  introduced/escalated risk;
- rely on rollback/recovery only to the extent its actual supported behavior is verified.

**Reason:** Troubleshooting frequently requires changing an existing app's configuration after
logs/health identify the cause. Doing that through a verified ZimaOS App Management API preserves
the project's supported-API architecture and enables useful repair workflows without granting the
agent arbitrary host-file, shell, Docker-socket, or privileged access.

**Rejected alternative:** Expose generic filesystem/Compose-file write access, SSH, shell, or
Docker-socket mutation. Those would bypass ZimaOS's application-management abstraction and expand
the trust boundary far beyond the repair capability needed for Phase 3.

**Research boundary:** Official source code may establish that a backend capability exists, but
product semantics such as exact endpoint shape, asynchronous behavior, concurrency, and rollback
must be characterized on the disposable ZimaOS VM before the mutating edit surface is implemented
or claimed safe.

## 2026-10-01 — Existing-app edits use interpolated read fingerprints and process-local reservations

**Decision:** Fingerprint the exact bytes returned by the official interpolated-YAML GET,
not the original stored YAML (which the API does not return). Before one official PUT
apply, compare the caller's base against a fresh GET while holding a per-app,
process-wide lock. Reserve the base after an accepted or uncertain attempt while
read-after-write may lag; release only on definitive rejection or an observed
different current fingerprint. `ALLOW_APP_EDIT` is independent and default-off.

**Reason:** Live conflicting PUTs both succeeded, and the official API offers no
conditional write. This bounds duplicate process-local edits without pretending to
prevent external races or prove completion from an asynchronous response. A single
read-only observation is not an automatic rollback or a second mutation.

**Rejected alternative:** Retry ambiguous PUTs or infer apply completion from a
message-only 200. Either could silently overwrite newer state; there is no verified
atomic CAS or reliable explicit rollback endpoint.

## 2026-10-01 — Phase 3 is the first-release feature cutoff; Phase 4 is release hardening

**Decision:** Phase 3 is complete and is the feature cutoff for the first public-facing release
candidate. Authorize Phase 4 as **Release Hardening + First Release**: improve deployment,
configuration/authentication UX, documentation, release engineering, automated regression, and
bounded real-user acceptance of the already-approved Phase 1–3 capabilities. Substantial new
capability families remain out of scope unless separately approved.

**Reason:** The existing feature set is broad enough for a meaningful first release. The remaining
risk is primarily whether a normal user can install, configure, connect to, understand, recover from
expected errors, upgrade, and remove/reinstall the product without developer-only rescue steps.
Those properties require release hardening plus actual user acceptance rather than more feature
expansion.

**Release gates:** Normal-user UAT is performed by the manager/user one bounded flow at a time.
Final version/tag/GitHub Release publication and source-repository or GHCR visibility changes require
explicit manager approval. A failed normal-user flow is treated as a release defect or documented
limitation rather than hidden with SSH, Docker-socket/CLI, direct filesystem, or undocumented-API
workarounds.

**Execution note:** The parent model should handle routine Phase 4 work itself. A local coding worker
is optional only for a genuinely substantial, bounded implementation workload; the parent retains
review, testing, Git, and release ownership.

## 2026-10-01 — One canonical sanitized repository; private history is preservation-only

**Decision:** Migrate the preserved sanitized project history into a new, initially private
`lvgvs/zimaos-mcp-server` repository. Preserve the original repository, original GitHub identity,
history, PRs and Actions as the private `lvgvs/zimaos-mcp-server-private-history` archive.
Only the new repository receives future development; no dual-write, mirroring or synchronization.
Keep the existing `ghcr.io/lvgvs/zimaos-mcp-server` package name; package access/linkage is a separate
manager gate. Repository Git commits/pushes/history operations remain Hermes/local-Git owned.

**Reason:** GitHub-managed closed-PR refs cannot be rewritten by ordinary Git pushes. A distinct
canonical repository preserves meaningful sanitized project history without importing those refs,
while retaining original private historical evidence without deleting or force-pushing it.

**Rejected alternative:** An in-place branch rewrite that leaves old PR history reachable, or
parallel active repositories that could accidentally reintroduce unsanitized history.

**Boundary:** Migrate `main` only; inspected old Dependabot branches contain generated dependency
updates, not unique manager/development work. Backup/candidate/PR refs stay out of the new remote.
Freeze the old repository after canonical CI/privacy verification and once doing so will not
obstruct GHCR access/linkage migration. Neither source nor package becomes public in this operation.

## 2026-10-07 — First-published commit artifacts; digest-based release promotion

**Decision:** Gate GHCR publication on successful trusted main-push CI. Serialize all publisher
and promotion workflows. Reuse an existing `sha-<commit>` artifact; publish a distinct run artifact
only on first publication, then seal the commit tag and promote aliases by that exact digest.
An existing commit/version tag with a conflicting digest fails closed. Development uses `edge`;
approved stable versions promote `stable`/`latest`, prereleases promote `prerelease`. Exact UAT
and deployments use registry digests. Prepared release automation does not create a Git tag or Release.

**Reason:** Same-source uncached builds regenerate filesystem/config timestamps, npm logs and V8
compile-cache data despite identical base images and identical compiled TypeScript bytes. Base
pinning reduces input drift but cannot alone make published commit tags immutable.

**Boundary:** Pin the verified Node 22 base digest, remove install caches/logs from runtime,
and publish standard minimum BuildKit provenance/SBOM using SHA-pinned maintained Docker actions.
Do not promise byte reproducibility or claim GHCR enforces tag immutability against administrators.
Avoid a custom rebuild/reproducibility system; retain and promote the known artifact instead.

## 2026-10-07 — Active readiness and origin-only configuration

**Decision:** Supersede the original always-200 readiness contract: HTTP 200 means an
authenticated, supported device-info read succeeded; false/error is HTTP 503. Production probes
share one in-flight request sequence, with one-second I/O limits including response consumption
and at most one existing read-only reauthentication retry. Docker probes the configured port.
This is dependency readiness, not proof that every app-management operation works.

**Reason:** A cached token and HTTP 200 for `ready:false` made container health lie after an
upstream outage. Active supported-API reads preserve the product boundary; no OS/socket/shell
control path or permanent background polling loop is introduced.

**Configuration/error boundary:** Accept only an HTTP(S) origin for ZimaOS, without embedded
credentials, a path prefix, query or fragment. Normalize through the URL parser. Parse PORT as
complete decimal digits with range validation. Reject shipped credential/token placeholders.
Never reflect raw configuration, upstream messages, transport exceptions or response-body
errors in startup/transport logs; retain static variable-specific config errors and normalized
codes. Reverse-proxy path prefixes are not supported by this origin-only deployment contract.

## 2026-10-09 — Do not substitute forced catalog refresh for verified app update

**Decision:** Keep `update_app` unexposed under Phase 5 Outcome B until a version-applicable
supported update contract establishes eligible classes, target/effects and observable result
semantics. Do not expose a force option or repurpose Compose editing/reinstallation to bypass
unverified native update eligibility. This is a project verification boundary, not a claim that
ZimaOS has no update API. Future verified implementation retains an independent default-off gate.

**Reason:** Legacy official source/SDK and a disposable forced associated-import transition
establish useful narrow facts, but not the current ordinary native update contract. Genuine
community/official native fixtures are manageable but current; no supported older-version
selection or genuine transition was established. Current public schema intentionally excludes
update override/runtime contracts. Mutable store association cannot prove native origin or safely
authorize overriding a user's image pin. Details and reopening evidence are in `docs/RESEARCH.md`.

**Rejected alternative:** Ship a force-based refresh tool using the earlier custom transition,
or infer current binary semantics and storage preservation from legacy implementation. Reopen
with version-applicable upstream contract/mapping and a supported genuine disposable transition;
neither empty update discovery nor a fixture-specific catalog 404 alone decides support.
