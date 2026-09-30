# Status

ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Current phase / milestone

- **Phase:** Phase 2 implementation, Phase 2E uninstall locally gated. Phases 2A–2D are committed and pushed; final live acceptance remains.
  Phase 1 tool behavior remains covered by automated tests. Historical live Phase 1 verification is retained below.
- **Phase B checkpoint:** `yaml@2.9.1` (ISC) selected for
  bounded safety inspection; original scratch probe failed (12 pass / 14 fail), focused
  synthetic parser checks passed (14/14). No detector or runtime changes.
- **Starting state:** Clean `main`, HEAD and remote main
  `06fe86c267c27648e48b8616944984b795cb86ae`, verified before editing documentation.
- **Live boundary:** No new ZimaOS requests/mutations in this Astra pass. Manager-provided
  final VM baseline is only `mcp-test-nginx`; do not repeat lifecycle probes.
- **Phase C checkpoint:** Official stable SDK v2 verified at split-package 2.1.0,
  modern protocol 2026-07-28, `createMcpHandler`/`toNodeHandler`, native `input_required`,
  and signed `requestState`. Concrete content/risk-bound approval proposal persisted;
  single-use enforcement is application-owned, and human presence cannot be proven.
- **Phase D checkpoint:** Separate default-off `ALLOW_APP_INSTALL`, `ALLOW_APP_UNINSTALL`,
  `ALLOW_APP_UPDATE` names finalized; `ALLOW_APP_CONTROL` remains start/stop/restart only.
  Named collisions fail closed; duplicate POST is not idempotent. Manager-provided live
  v1.7.1 findings recovered, including schema-invalid 502 and deterministic duplicate app.
  Actual App Store update semantics remain blocked/unverified.
- **Current milestone:** Phase 2E `uninstall_app` and default-off independent permission
  are implemented and mocked. Phase 2D was pushed at
  `e5f5a6ef400a5278c671a5c44562c52c49969664`; Phase 2E commit/push pending final gates.
- **Next action:** Gate/review/commit Phase 2E, then bounded live MCP acceptance on
  the disposable VM and cleanup to the pre-existing `mcp-test-nginx` baseline.
  App Store update semantics remain unverified; no update tool.

## Git / repository

- **Branch:** `main`
- **Phase 2B HEAD:** `e8774f23ce9ecf55050eaac7b0767a3595c72109`, pushed to `origin/main`.
- **Phase 2C HEAD:** `d579a259049250f43b41ff7110a43106d6817e63`, pushed to `origin/main`.
- **Phase 2D HEAD:** `e5f5a6ef400a5278c671a5c44562c52c49969664`, pushed to `origin/main`.
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server (**private**, per Phase 1 rule)
- **Research base SHA:** `06fe86c267c27648e48b8616944984b795cb86ae`.
- **Research checkpoint HEAD:** the commit containing this status, intended as
  `docs: complete Phase 2 provisioning research`; obtain its exact SHA with `git rev-parse HEAD`
  (a commit cannot contain its own SHA). Final chat handoff reports the pushed SHA.
- Repository was independently rechecked **PRIVATE** in this pass; visibility unchanged.

## Pause checkpoint — Phase 2B (2026-09-28)

This section is a historical pause snapshot, superseded by the current milestone above and
the resumed implementation record below.

- **HEAD / branch / remote:** `0968107dc5280b4e0099e0d8b2538634eaf5ab6c`,
  `main`, remote `main` matched. Phase 2A (`0968107`) was committed and pushed
  before the pause; no commit or push was made during the pause procedure.
- **Completed bounded work since Phase 2A:** Added exact `yaml@2.9.1` production
  dependency and a bounded parser (`src/compose/parse.ts`), preserving the original
  string and rejecting malformed/warning/ambiguous or over-budget YAML. Added a
  structured Compose risk analyzer (`src/compose/analyze.ts`) for privileged mode,
  host namespaces, runtime socket/host binds, devices, added capabilities,
  security options, named-volume indirection, and unsupported external includes/
  builds/extends. Parser and analyzer have focused tests. Neither is wired to an
  MCP tool yet; this is not a complete safety proof for arbitrary Compose.
- **Last Qwen task:** Add non-mutating `ZimaOsClient.validateCompose` using the
  supported dry-run/port-check query, exact YAML body, and normalized 200/400/502
  outcomes, with mocked tests. The child was steered for pause and specifically
  stopped at an edit boundary; its final result was **interrupted**. It changed
  `src/zimaos/client.ts` and `tests/client.test.ts`. Seven dry-run tests exist,
  but security review remains unfinished: a 401/403 response is currently
  classified as a validation rejection instead of an authentication/authorization
  failure, an upstream `message` is surfaced without proving it cannot echo
  submitted Compose content, and a 2xx envelope with `success:false` is not
  distinguished from acceptance. Do not expose the method through MCP before fixing.
- **Intentionally dirty worktree:** modified `package.json`, `package-lock.json`,
  `src/zimaos/client.ts`, `tests/client.test.ts`; untracked
  `src/compose/parse.ts`, `src/compose/analyze.ts`,
  `tests/composeParse.test.ts`, `tests/composeAnalyze.test.ts`, plus this status
  update. No tracked files were reset or recreated; the local secret env remains ignored.
- **Verification at pause:** focused client/parser/analyzer tests **133/133 passed**;
  production and test TypeScript checks passed; `git diff --check` passed.
  Earlier, before the interrupted dry-run edits, the parent independently ran
  the full mocked suite at **122/122**; the analyzer child separately reported
  **160/160** after its extension. Formatting currently **fails**
  on `src/zimaos/client.ts` and `tests/client.test.ts`. The full suite, lint,
  build, Docker build, and Compose validation were **not rerun** on the current
  dirty tree. No Phase 2 live VM acceptance was performed.
- **Remaining after resume:** finish Phase 2B safe validation tool/API tests and
  full gates; Phase 2C install permission, duplicate protection and single POST;
  Phase 2D modern single-use risky approval; Phase 2E uninstall; live benign
  acceptance, cleanup, docs and gates. `update_app` remains intentionally
  unimplemented pending verified App Store update semantics. No child remains active.

## Phase 2B resumed implementation (local, mocked)

- `yaml@2.9.1` parser applies UTF-8 byte, depth, node, alias and traversal budgets,
  rejects warnings, duplicate merge keys and cycles, and preserves the exact source.
  Risk analyzer reports fixed-category host-control findings; validation fails closed if
  more than 256 findings would be returned. Local analysis is not Docker Compose validation.
- `ZimaOsClient.validateCompose` posts the exact source as YAML with explicit dry-run and
  port-conflict checks. HTTP 401 reauthenticates once, 403 remains a permission failure;
  upstream free-form messages are never relayed. HTTP 2xx `success:false` is not accepted;
  empty 502 remains ambiguous, not proof of invalidity or outage. No real install POST.
- `AppService.validateCompose` and `validate_app_compose` MCP tool perform local analysis
  then upstream dry-run without requiring top-level `name:` or app-control permission.
  Invalid local documents stop before contacting ZimaOS. Phase 1 tools remain registered.
- Independently executed on this worktree: `npm test` **191/191** across 8 files,
  `npm run lint`, `npm run format:check`, production and test TypeScript checks,
  `npm run build`, `docker build -t zimaos-mcp-server:phase2b .`,
  `docker compose -f deploy/zimaos/docker-compose.yml config --quiet`, and
  `git diff --check` — all passed. These are mocked/local gates, not live VM acceptance.
  `.env.integration.local` remains Git-ignored. No Phase 2 live VM action yet.
- Branch `main`; base commit before Phase 2B is `0968107dc5280b4e0099e0d8b2538634eaf5ab6c`;
  repository https://github.com/lvgvs/zimaos-mcp-server (private). GHCR Phase 2 image not
  verified; ZimaOS Compose deployment not yet exercised for Phase 2.

## Phase 2C implementation checkpoint (uncommitted, mocked)

- Dedicated `ALLOW_APP_INSTALL` permission defaults off independently of Phase 1 control.
  `ZimaOsClient.installComposeOnce` sends one exact-source YAML POST with explicit
  `dry_run=false` and port checking, never retries after a mutation attempt, and reports
  asynchronous acceptance separately from completion. HTTP 429 remains rate limiting.
- Local install identity requires explicit safe top-level name and rejects collisions
  against app id/display name. Preflight lists installed apps and performs one upstream
  dry run, failing closed on invalid/ambiguous response and port conflicts. Risky input
  returns confirmation-required without mutation. Safe-install service serializes
  preflight and one real POST with an in-process queue. This does not eliminate races
  against actors outside this server or guarantee immediate app-list visibility after
  asynchronous acceptance.
- Independently ran `npm test`: **250/250** across 12 files; production and test
  TypeScript checks, lint, format check and `git diff --check` passed after correcting
  a test type error and unused import. These are mocked/local results; no Phase 2C
  Docker build or live VM test yet. The previous concurrency child timed out after
  leaving valid partial code/tests; the parent retained, fixed and verified them.
- **Not implemented/exposed:** `install_app_from_compose` MCP tool, risk challenge /
  post-disclosure approval, uninstall, update. No Phase 2C commit/push yet. The
  higher-level manager approved the existing modern MCP input-required design,
  content-bound signed state, expiring bounded single-use ledger, rechecks and
  consume-before-one-POST rule, modern-only risky path, and explicit human-presence
  limitation. A new scope/safety issue, not this existing design, would be a blocker.

## Pause checkpoint — Phase 2C (2026-09-29)

This is a historical pause snapshot, superseded by the resumed Phase 2C milestone below.

- `main` HEAD `e8774f23ce9ecf55050eaac7b0767a3595c72109` (pushed Phase 2B);
  Phase 2A was committed/pushed at `0968107dc5280b4e0099e0d8b2538634eaf5ab6c`.
  Worktree intentionally dirty: modified `STATUS.md`, `src/config.ts`, `src/errors.ts`,
  `src/index.ts`, `src/permissions.ts`, `src/zimaos/appService.ts`, `src/zimaos/client.ts`,
  `tests/client.test.ts`, `tests/config.test.ts`, `tests/permissions.test.ts`; untracked
  `src/zimaos/installIdentity.ts`, `src/zimaos/installPreflight.ts`,
  `tests/installIdentity.test.ts`, `tests/installPreflight.test.ts`,
  `tests/installSafe.test.ts`, and `tests/installConcurrency.test.ts`.
- Last Qwen task `sa-0-32740bb6`: process-wide install-name reservation to prevent
  a second same-name POST while the asynchronous ZimaOS app list is stale. It was
  steered to stop at the atomic test-file write and completed in response to pause;
  **only** `tests/installConcurrency.test.ts` changed in this task. No reservation
  implementation was written. Tests encode accepted/timeout stale-list behavior;
  they remain TDD-red, not a passing feature. No child remains active.
- Parent reviewed the full test file and service. `installSafeCompose` currently has
  a process-wide serialization queue but **no name reservation**; its comment claiming
  a second request will see the new app in the list is not guaranteed. The queue
  permits a duplicate POST if a subsequent list read is stale. Do not expose the
  install tool or claim duplicate protection complete until corrected. No global
  unsafe bypass or mutation retry was introduced in the last child edit.
- Focused `npx vitest run tests/installConcurrency.test.ts` on the present worktree:
  **2 passed, 2 failed**, exactly the accepted-stale-list and timeout-stale-list
  reservation expectations. `npx tsc -p tsconfig.test.json --noEmit` passed;
  `npx prettier --check tests/installConcurrency.test.ts` failed (formatting).
  `git diff --check` passed. Before the last test edit, parent independently ran
  full mocked `npm test` **250/250**, lint, format, production/test typechecks;
  those full gates were **not rerun on the present worktree**. Phase 2C build,
  Docker build, Compose config and live VM acceptance have not been run.
- **First bounded resume action:** implement a fail-closed, process-wide reservation
  for the exact normalized install name after ready preflight and before the one
  real POST; keep accepted/uncertain attempts reserved through list lag, release
  only on definitive rejection or known pre-POST failure. Run the new focused tests,
  both TypeScript checks and format the test; independently review diff/semantics.
  Do not silently infer an arbitrary reservation expiry or retry uncertain installs.
- Remaining Phase 2C: finish reservation, wire/install-test the MCP tool without
  bypassing the risky post-disclosure flow, update deployment/docs/config, run full
  gates, and commit/push only a coherent milestone. Then Phase 2D approved single-use
  risky approval, Phase 2E independently gated uninstall, Phase 2 live acceptance
  and disposable-VM cleanup. `update_app` remains unimplemented pending verified
  App Store semantics. No new child, commit, push, or live operation occurred for
  this pause. Preserve all dirty work; wait for explicit resume.

## Phase 2C resumed milestone (local, mocked)

- `ALLOW_APP_INSTALL` defaults off independently of reversible app control. Safe install
  requires an explicit conservative top-level name, checks host id/display-name collisions,
  performs a fresh list read and upstream dry run with port-conflict checking, and preserves
  the exact original YAML for at most one real POST. Risky findings return
  `confirmation_required` without mutation; no Phase 2D approval is present yet.
- A serialized process-wide queue and bounded fail-closed name reservations prevent a
  second same-name POST even if the upstream list lags after asynchronous acceptance or an
  ambiguous timeout. A definitive rejection releases its reservation. Reservations are
  process-local and retained for uncertain outcomes; this does not prevent external writers,
  nor does it establish completion. No automatic mutation retry or global unsafe bypass.
- `install_app_from_compose` is registered over authenticated MCP; `.env.example`, README,
  and ZimaOS deployment Compose document the default-off permission and safe path.
- Independently executed: mocked `npm test` **258/258 across 12 files**; lint, format check,
  production/test TypeScript checks, production build, Docker build
  (`zimaos-mcp-server:phase2c`), deployment Compose config validation and `git diff --check`
  all passed. No Phase 2C live VM test or GHCR publication verified yet.
- Branch `main`, base HEAD `e8774f23ce9ecf55050eaac7b0767a3595c72109` before
  Phase 2C commit. Repo https://github.com/lvgvs/zimaos-mcp-server (private).
  Phase 2D risky approval, Phase 2E uninstall and final live acceptance remain.

## Phase 2D implementation (local, mocked; committed)

- Modern MCP 2026-07-28 risky installs return native `input_required` form elicitation
  after a non-mutating preflight. The message discloses fixed risk categories/fields,
  exact source SHA-256 and expiry. Legacy risky installs fail closed; benign legacy
  installs remain available under the default-off install permission.
- Exact UTF-8 source, intended name, target digest, fixed install options and risk
  policy/disclosure digest are bound into HMAC-signed, 300-second request state. An
  independently bounded process-wide pending/consumed challenge ledger enforces
  single use. The signing key is ephemeral; restart invalidates pending approval.
  The deployment's authenticated bearer principal is bound without exposing its token.
- A second modern request requires signed state and accepted `confirm: true` form
  content. Under the same install lock it rechecks permission, host identity,
  parsed risks, upstream dry run and port conflicts, then consumes approval before
  one exact-source POST. It preserves the name reservation on accepted/uncertain
  outcomes and does not retry mutation. An accepted result receives one bounded
  read-only list observation (`observed`/`pending`); neither proves completion.
- Independently ran mocked `npm test` **360/360 across 17 files**, lint, format,
  production/test TypeScript checks, build, Docker build (`zimaos-mcp-server:phase2d`),
  deployment Compose validation, and `git diff --check` — all passed.
  No live Phase 2 VM action has occurred. Client-side human presentation is a
  requirement of the chosen client, not a cryptographic property of MCP;
  automated tests verify wire behavior, not actual human presence.
- Phase 2D committed/pushed at `e5f5a6ef400a5278c671a5c44562c52c49969664`.
  Next: Phase 2E uninstall, then final live benign acceptance and VM
  cleanup. App Store update semantics remain unverified; `update_app` is absent.

## Phase 2E implementation (local, mocked)

- Independent default-off `ALLOW_APP_UNINSTALL` does not imply install or app control.
  `uninstall_app` validates an explicit conservative id and confirms exact presence in
  a fresh host list before the single supported DELETE with
  `delete_config_folder=false`. No arbitrary path, volume, or host cleanup is exposed.
- Shared process-wide serialization and bounded same-id reservations prevent another
  DELETE while an accepted or ambiguous attempt is unresolved, even with a stale list.
  A definitive rejection releases a reservation. An accepted response is asynchronous,
  with one bounded read-only list observation (`pending`/`absent`), not completion proof.
  No automatic mutation retries. Storage retention effects remain unverified.
- Independently ran mocked `npm test` **388/388 across 19 files**, lint, format,
  production/test TypeScript checks, build, Docker build (`zimaos-mcp-server:phase2e`),
  Compose config validation, and `git diff --check` — all passed. No Phase 2E live
  VM acceptance yet; GHCR publication of this image has not been verified.

## Phase 2A implementation verification (local, mocked)

- Started at `baf1adc4830fb470a1e924c191fcc3f2b1b702b8` with pre-existing
  uncommitted split-package manifest/lock changes; reconciled and retained them.
- `npm test`: 5 files / 55 tests passed (including modern and legacy HTTP paths,
  bearer boundary and 1 MiB rejection); `npm run lint`, `npm run typecheck`,
  `npx tsc -p tsconfig.test.json --noEmit`, `npm run format:check`, and
  `npm run build`: passed.
- `docker build -t zimaos-mcp-server:phase2a .` and
  `docker compose -f deploy/zimaos/docker-compose.yml config --quiet`: passed.
- Live ZimaOS integration was not rerun for Phase 2A. GHCR/CI for this milestone
  were not checked after the push. No Phase 2 provisioning tools yet.

## Research checkpoint verification / blockers

- Original scratch parser probe: 12 passed / 14 failed; defects/coverage recorded in research.
- Focused synthetic parser checks: 14/14 passed; no network or VM interaction.
- `npm run format:check`: passed (whole repo); only the three allowed Markdown files
  were targeted for formatting. `git diff --check`: passed. Checkpoint diffs reviewed;
  scope is docs-only. `.env.integration.local` is still Git-ignored (content not read).
- No runtime test/build, Docker build, SDK round-trip, or new live integration was run
  for this docs-only pass. Historical Phase 1 results below are not current reruns.
- `.env.integration.local` was not opened. No credentials or derived secret material
  were used or exposed. `AGENTS.md`, `PROJECT.md`, runtime, tests, dependencies, Docker,
  deployment Compose, and CI remain untouched.
- Review needed: modern-only risky approval, single-use/300-second/single-process proposal,
  client human-UI enforcement limit, explicit-name install proposal, parser limits/subset.
- Blocked semantics: App Store update transitions; uninstall storage effects and
  `uncontrolled` behavior. No additional live probes authorized in this checkpoint.
- GHCR/deployment: no Phase 2 image or deployment readiness claimed. Historical private
  Phase 1 image/Compose status is retained below; this docs push may trigger existing CI
  and publishing, but their new results will not be claimed without verification.

## Historical Phase 1 record (not rerun by this research pass)

## Correction-pass commits (Phase 1 session, all on `main`, all pushed)

- `docs(research): correct containers/healthcheck findings against live v1.7.1` — reconciles
  `docs/RESEARCH.md` with a secret-safe raw re-probe of the disposable VM (see "Live API shape
  re-probe" below).
- `ci(ghcr): tag every published build with immutable sha-<GITHUB_SHA>` — `.github/workflows/ghcr-publish.yml`.
- `docs(readme): add MCP client connection example and GHCR tag strategy` — `README.md`.
- This status-record commit (final HEAD of the pass).

## Committed & pushed milestones (all on `main`, all pushed)

- Core implementation (`a3cd9e8`): strict TypeScript MCP server with typed ZimaOS client (login,
  bearer session, auto re-login on 401), domain services (apps/system), permission layer (app
  control disabled by default), Phase 1 tool set, authenticated Streamable HTTP transport +
  `/health`.
- Mocked test milestone (`7396929`): 52 vitest cases across 5 suites with a shared fake-fetch
  harness; covers config validation, client session behavior, permission layer, MCP tools over
  InMemoryTransport, and the HTTP transport (auth rejection, health readiness, authenticated round
  trip). Includes the `probeComposeAppHealth` fix.
- Docs handoff (`1bd0cf1`, corrected by `0b292e3`).
- Docker packaging (`acc8051`): multi-stage, non-root, prod-deps-only `Dockerfile` + `.dockerignore`.
  Committed only after the production image was built and live-exercised.
- Deploy Compose (`6bfe1ce`): `deploy/zimaos/docker-compose.yml`, paste-ready for a ZimaOS Custom
  App (host-gateway networking, no privileged socket).
- CI + GHCR workflows (`6da18f6`): `.github/workflows/ci.yml` and `.github/workflows/ghcr-publish.yml`.
  Neither depends on the disposable VM; no VM credentials in Actions.
- Docs (`a408e0d`): `README.md`, Apache-2.0 `LICENSE`, `.env.example`, host-gateway research note in
  `docs/RESEARCH.md`.
- Status progress record (`0797d3e`).
- Formatting normalization (`e16ba21`) and README tool-list correction (`e612d91`).
- Phase 1 completion status (`f7698c3`), then manager commit `90385b2` (AGENTS.md tracked-file
  mutation safety rules) — local checkout fast-forwarded to it before this pass.

## Automated test status (exact, re-run for the correction pass)

- **5 files / 52 tests — all passing** (mocked, no network). `vitest run` → "Test Files 5 passed",
  "Tests 52 passed".

## Full local quality gates — ALL PASSING (re-run against the committed tree)

- `npx prettier --check .` — **pass** ("All matched files use Prettier code style!"). One
  pre-existing non-conforming line in this file at HEAD was fixed by this rewrite.
- `npm run lint` (`eslint .`) — **pass** (0 errors).
- `npm run typecheck` (`tsc -p tsconfig.json --noEmit`, strict) — **pass**.
- Test type check (`npx tsc -p tsconfig.test.json --noEmit`, strict) — **pass**.
- `npm test` — **52/52 pass**.
- `npm run build` (`tsc -p tsconfig.json`) — **passes**; emits `dist/` (gitignored).
- Docker image build from the committed tree — **success** (multi-stage, non-root; no BuildKit
  frontend dependency).
- Compose validation (`docker compose -f deploy/zimaos/docker-compose.yml config --quiet`) —
  **pass**.

## CI status (GitHub Actions)

- **Workflow:** `.github/workflows/ci.yml` on push to `main`. Steps: install → format check (Prettier) → lint → typecheck → test typecheck (`tsconfig.test.json`) → tests → production build → Docker image build → Compose validation (`docker compose config`). CI now explicitly enforces both Prettier formatting and strict test TypeScript checking, matching the full local Phase 1 gate.
- **Result for the correction-pass push — success.** Run `36282720203`, head SHA
  `2573f9e02f016a3106ffd0b9c842b9594597bf0e` (the correction-pass HEAD), conclusion **success**.
  CI does not depend on the disposable VM and contains no VM credentials.

## GHCR status

- **Workflow:** `.github/workflows/ghcr-publish.yml` on push to `main` (and `v*` tags), using the
  auto-provided `GITHUB_TOKEN`. No VM dependency, no permanent registry credentials or PATs.
- **Result for the correction-pass push — success.** Run `36282720213`, head SHA
  `2573f9e02f016a3106ffd0b9c842b9594597bf0e` (the correction-pass HEAD), conclusion **success**.
- **Tags actually pushed (from the workflow log):** `latest` and immutable
  `sha-2573f9e02f016a3106ffd0b9c842b9594597bf0e`, both digest
  `sha256:f0b084a9…` (identical image — the immutable tag is a reproducible reference to exactly
  this build). This confirms the new commit-tag path works end-to-end in CI.
- **Tag strategy (implemented this pass):** every published build receives an immutable
  `sha-<GITHUB_SHA>` tag; pushes to `main` also publish `latest`; pushed `v*` release tags also
  publish the version tag and `latest`. Documented in README ("GHCR image references").
- **Package:** `ghcr.io/lvgvs/zimaos-mcp-server`, visibility **private** (inherits repository).
  Pulling requires a GitHub token with `read:packages` scope.

## Live integration status — full Phase 1 MCP matrix (authorized disposable VM)

Executed against ZimaOS v1.7.1 using `.env.integration.local` (never echoed; file remains
git-ignored and untracked). The server under test was the **production container artifact**
built from this repository's committed `Dockerfile`, run with `--env-file .env.integration.local`.

### Live API shape re-probe (RESEARCH.md reconciliation)

Secret-safe raw probe of the ZimaOS API (structure facts only; no credential values):

- `GET /v2/app_management/compose/{id}/containers` → HTTP 200 envelope containing **only**
  `{ data }` on live v1.7.1 (no `success`/`message`). `data = { main, containers }`;
  `containers` is a **map keyed by service name** (`nginx`), each value the container record
  (`ID`, `Name`, `Image`, `Service`, `State`, `Status`, `Health`, `Publishers`, ...). Not a flat
  array. Matches the implementation's normalizer.
- `GET /v2/app_management/compose/{id}/healthcheck` → HTTP **200** with a minimal body (no
  structured health-status data on this version); the HTTP status is the usable health signal,
  which is how `probeComposeAppHealth` treats it.

### Read path — all exercised through MCP (sanitized results)

- Unauthenticated `POST /mcp` → **401** (negative control).
- Authenticated `tools/list` → **9 tools**: `get_app`, `get_app_health`, `get_app_logs`,
  `get_system_info`, `list_app_containers`, `list_apps`, `restart_app`, `start_app`, `stop_app`.
- `list_apps` → 1 app: `mcp-test-nginx`, status `running`.
- `get_app` (`mcp-test-nginx`) → normalized details, status `running`.
- `get_app_health` → probe state **healthy**; 1 container (`nginx`, `running`).
- `get_app_logs` (bounded, `lines=20`) → non-empty bounded log text returned.
- `list_app_containers` → 1 container: service `nginx`, image `nginx:alpine`, state `running`,
  published port mapping present.
- `get_system_info` → real VM facts: hostname `ZimaOS`, OS version **v1.7.1**, arch `amd64`.

### Security / permissions — exercised through MCP

- Unauthenticated MCP request → **401** (above).
- With `ALLOW_APP_CONTROL=false`: `stop_app` returned the expected permission error
  `[APP_CONTROL_DISABLED] ... Set ALLOW_APP_CONTROL=true to enable it.` (tool-level error, no
  state change).

### Control path — exercised through MCP (`ALLOW_APP_CONTROL=true`)

Using the disposable test app `mcp-test-nginx`:

- `stop_app` → ok; polled status reached **exited** (~3 s).
- `start_app` → ok; polled status reached **running** (~3 s); health probe **healthy**.
- `restart_app` → ok (ZimaOS accepted the restart PUT); recovery verified: status **running**,
  health probe **healthy** on first poll. Note: ZimaOS recreates containers asynchronously and the
  compose-level status can read `running` throughout a fast recreation, so the stop transition was
  not separately observable in the final run; an earlier run did observe the intermediate
  container churn (port conflict during recreation) before recovery — consistent with async
  recreation, not a product defect.
- **Final state after all control operations:** `mcp-test-nginx` status **running**, health probe
  **healthy** — disposable test app restored to healthy/running as required.

## Documentation status

- Present: `AGENTS.md`, `PROJECT.md`, `DECISIONS.md`, `docs/RESEARCH.md`, `STATUS.md`, `README.md`,
  `LICENSE` (Apache-2.0), `.env.example`, `deploy/zimaos/docker-compose.yml`.
- README documents: setup, configuration (all env vars incl. `ALLOW_APP_CONTROL` default-off), the
  exact MCP tool list (verified against `src/mcp/tools.ts`), **MCP client connection example**
  (Streamable HTTP endpoint URL + `Authorization: Bearer <MCP_AUTH_TOKEN>`, no real secrets),
  **GHCR tag strategy** (`latest`, `v*`, immutable `sha-<GITHUB_SHA>`), ZimaOS Custom App
  deployment via the paste-ready Compose, and the private-image pull limitation.

## Secrets / integration env file

- `.env.integration.local` is **ignored** (`.gitignore:9:.env.*`), **untracked**, and **unstaged**.
  No secrets are committed or staged; no credential values were printed in this session's logs,
  docs, or status. Verified with `git check-ignore -v .env.integration.local` → ignored.

## Known limitations

- GHCR image is private (inherits repo visibility); consumers need a token with `read:packages`.
  Documented in README; no action required for Phase 1 scope.
- A live ZimaOS Custom App paste/install through the ZimaOS UI remains the one optional manual
  verification item permitted by PROJECT.md; the Compose file is validated and paste-ready, but
  was not pasted into the VM's UI in this session.

## Historical Phase 1 manual actions

- **None blocking.** No privileged or manual step is needed for Phase 1 completion.
- Optional: paste `deploy/zimaos/docker-compose.yml` into a ZimaOS Custom App on the disposable VM
  as an end-to-end UI verification (the container artifact itself is already verified).

## Recommended next action for the manager

Continue Phase 2C after the reviewed Phase 2B commit/push. Preserve the existing
safety model, do not infer App Store update semantics, and perform live benign
acceptance/cleanup only after the remaining provisioning milestones pass gates.
