# Status

Phase 1 — ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Current phase / milestone

- **Phase:** Phase 1 (implementation complete through the mocked-test milestone; packaging next).
- **Current milestone:** Handoff-integrity correction — this file replaces an earlier, incomplete
  status doc that was committed by mistake. No new implementation work is done in this commit.

## Git / repository

- **Branch:** `main`
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server (private)
- **HEAD prior to this correction:** `1bd0cf1` (`docs: record Phase 1 status and architectural
decisions for handoff`). That commit committed an incomplete/incorrect earlier STATUS.md; this
  file corrects it. The SHA of the correction commit is whatever contains this file — see
  `git log -1 --oneline`.

## Committed & pushed milestones

- Core implementation (`a3cd9e8`): strict TypeScript MCP server with typed ZimaOS client (login,
  bearer session, auto re-login on 401), domain services (apps/system), permission layer (app
  control disabled by default), Phase 1 tool set, authenticated Streamable HTTP transport +
  `/health`.
- Mocked test milestone (`7396929`): 52 vitest cases across 5 suites with a shared fake-fetch
  harness; covers config validation, client session behavior, permission layer, MCP tools over
  InMemoryTransport, and the HTTP transport (auth rejection, health readiness, authenticated round
  trip). Includes the `probeComposeAppHealth` fix.
- Docs handoff (`1bd0cf1`): added DECISIONS.md; committed an incomplete STATUS.md (now corrected by
  this file).

## Automated test status (exact)

- **5 files / 52 tests — all passing** (mocked, no network). Re-verified this session: `vitest run`
  → "Test Files 5 passed", "Tests 52 passed".
- Suites: config, client session, permissions, tools (InMemoryTransport), HTTP transport.

## Type-check / build gates that pass

- `tsc -p tsconfig.json --noEmit` — **pass** (production type check).
- `tsc -p tsconfig.test.json --noEmit` — **pass** (test type check, strict).
- `npm run build` (`tsc -p tsconfig.json`) — **passes**; emits `dist/` (gitignored).

## Formatting / lint status (NOT passing — recorded honestly)

The committed test milestone does NOT pass the formatter/linter. This is pre-existing debt on the
test files, not introduced by this correction:

- `eslint .` — **2 errors** (`@typescript-eslint/consistent-type-imports`):
  - `tests/helpers/fakeZimaOs.ts:11`
  - `tests/http.test.ts:8`
- `prettier --check .` — **5 files fail**:
  - `tests/client.test.ts`, `tests/config.test.ts`, `tests/helpers/fakeZimaOs.ts`,
    `tests/http.test.ts`, `tests/tools.test.ts`

Do not claim eslint/prettier pass. Fixing this debt is a small follow-up (convert the two type-only
imports to `import type`, then run `prettier --write` on the five test files) and should be done
before the final quality gate, but it was intentionally NOT bundled into this handoff correction.

## Live disposable-ZimaOS API findings already verified (sanitized)

Verified against ZimaOS v1.7.1 (x86_64) on the authorized disposable VM; full detail in
`docs/RESEARCH.md`:

- **`POST /v1/users/login`** — envelope `{success,message,data}`; `data.token` is an **object**
  `{access_token, refresh_token}`, not a string. Downstream calls use
  `Authorization: Bearer <access_token>`.
- **`GET /v2/app_management/compose`** — envelope; `data` = object map keyed by app id →
  `ComposeAppWithStoreInfo` (not an array).
- **`GET /v2/app_management/compose/{id}/containers`** — envelope; `data` = array of containers.
- **`PUT /v2/app_management/compose/{id}/status`** — request body is a raw JSON **string** enum
  (`"start"`/`"restart"`/`"stop"`), not an object; response is a `BaseResponse` envelope.
- **Logs `lines` behavior** — `GET .../logs?lines=N`; `lines` bounds the size, `data` = string.
  Always pass a bounded `lines`.
- **`GET /v2/zimaos/device/info`** — returns a **bare payload** (no `{success,message,data}`
  wrapper).
- **Envelope differences** — app-management and user-service use the `{success,message,data}`
  envelope; the core service (`/v2/zimaos`) returns bare payloads. Clients are written to each rule.
- **Nullable `store_info.title` fallback implication** — `title` may be null for some apps;
  normalization falls back to the app id (`src/domain/models.ts`).

## MCP SDK / transport approach (verified)

- **SDK:** `@modelcontextprotocol/sdk` **1.30.1**.
- **Transport:** authenticated Streamable HTTP over a single endpoint `POST /mcp`, plus an
  unauthenticated `GET /health` readiness probe on the same HTTP server. Bearer auth via
  `MCP_AUTH_TOKEN`; no default token; fail-fast at startup.

## Known bug already fixed

- **`probeComposeAppHealth`:** now uses the client's raw authenticated request (HTTP status is the
  signal) instead of the `{success,message,data}` envelope parser, because the compose health
  endpoint is a `BaseResponse`. The old path misreported a 200 with an empty body as "unhealthy".
  Fixed in the test milestone (`7396929`).

## Docker / packaging status

- **Docker availability:** Docker is **not installed/available** in the Hermes environment yet. This
  blocks building/exercising the production image and therefore gates live-container integration.
- **Packaging files present but UNTRACKED (intentionally uncommitted):** `Dockerfile` and
  `.dockerignore`. They are coherent multi-stage, non-root, prod-deps-only packaging, but no Docker
  build has verified them yet, so they are deliberately left untracked until the image builds
  successfully. Do not commit them before a successful build.

## Podman fallback status

- A previous rootless-Podman fallback attempt was **cancelled before it installed anything**. No
  persistent Podman packages/binaries/config were introduced; there is nothing to remove. The
  project uses Docker, not Podman.

## CI / GHCR status

- **CI:** no `.github/workflows/` yet — CI workflow not created.
- **GHCR:** image not built/published; publishing workflow not created.

## Documentation status

- Present: `AGENTS.md`, `PROJECT.md`, `DECISIONS.md`, `docs/RESEARCH.md`, `STATUS.md`.
- Missing (Phase 1 deliverables still to create): `README.md`, `LICENSE` (Apache-2.0), `.env.example`.

## Secrets / integration env file

- `.env.integration.local` is **ignored** (`.gitignore:9:.env.*`), **untracked**, and **unstaged**.
  No secrets are committed or staged. Its values must never be printed, logged, or copied into
  tracked files.

## Current known blocker

- Docker tooling must be made available in the Hermes environment before the production image can be
  built/verified and before downstream live-container integration. This is an environment action
  (install `docker.io`, start/enable the daemon), not a code change.

## Remaining Phase 1 work (correct order)

1. Make Docker available in the Hermes environment (install + start/enable daemon).
2. Build & exercise the production image from the already-present untracked `Dockerfile` /
   `.dockerignore`; once it builds and runs, commit those two files.
3. Create ZimaOS paste-ready Compose: `deploy/zimaos/docker-compose.yml`.
4. Create CI workflow (`.github/workflows/`).
5. Create GHCR publishing workflow.
6. Add remaining docs: `README.md`, `LICENSE` (Apache-2.0), `.env.example`.
7. Run full local quality gates, reported separately: formatter/linter; production TypeScript
   build/type-check; test TypeScript type-check; full mocked suite; Docker image build. (Fix the
   recorded eslint/prettier debt first.)
8. Live integration against the authorized disposable VM using `.env.integration.local` (never
   echoed).
9. Final manager handoff.

## Known limitations

- No `README.md`, `LICENSE`, or `.env.example` yet.
- No CI/GHCR workflows and no deploy Compose YAML yet.
- Docker image build not performed (no Docker in the environment); production container artifact not
  yet exercised.
- Live integration against the disposable VM not yet performed.
- Pre-existing formatting/lint debt on 5 test files (2 eslint errors + 5 prettier files) — see above.

## Manual actions required

- None that require user interaction beyond ensuring Docker can be installed/started in the
  environment. No manual UI step is blocking at this point; a live ZimaOS Custom App paste/install
  may remain as one explicit manual verification item near the end (per PROJECT.md).

## Recommended next action for a fresh chat

Make Docker available in the Hermes environment, then build and exercise the production image from
the already-present untracked `Dockerfile` / `.dockerignore`; once it builds and runs cleanly, commit
those two files and proceed to Compose → CI → GHCR → docs → full quality gates → live integration.
Do not begin Phase 2.
