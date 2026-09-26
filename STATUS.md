# Status

Phase 1 — ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Current phase / milestone

- **Phase:** Phase 1 (implementation complete through the mocked-test milestone; packaging next).
- **Current milestone:** Production image built and live-exercised in a container against the
  disposable ZimaOS VM; `Dockerfile` + `.dockerignore` committed. Next: Compose → CI → GHCR → docs
  → full quality gates → final handoff. No Phase 2 work.

## Git / repository

- **Branch:** `main`
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server (private)
- **HEAD:** see `git log -1 --oneline`. Latest: `acc8051` (`build: add production Docker
  packaging (verified image build + live container run)`), on top of `0b292e3` (docs handoff
  correction).

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

- **Docker availability:** installed and running in the Hermes environment (agent-installed via
  direct foreground `sudo`; daemon active, client/server 26.1.5). The session has been restarted so
  unprivileged `docker` works — verified with `id` (groups include `docker`) and `docker info` /
  `docker version` without sudo. No further privileged Docker operations are needed for normal work.
- **Production image built & live-exercised:** `zimaos-mcp-server:local` (186 MB) built from the
  committed multi-stage, non-root, prod-deps-only `Dockerfile`. Live container run against the
  disposable ZimaOS VM confirmed: `/health` → `{status:"ok",ready:true}`; authenticated MCP round-trip
  over Streamable HTTP listed all 9 tools and returned real data (`get_system_info` → ZimaOS v1.7.1,
  `list_apps` → the VM's test app); an unauthenticated `/mcp` request was correctly rejected with 401.
- **Packaging files COMMITTED** in `acc8051`: `Dockerfile` and `.dockerignore`. The Dockerfile no longer
  uses a `# syntax=docker/dockerfile:1` frontend directive (removed — see DECISIONS.md), so the build
  needs no external BuildKit frontend image.
- **Build note:** this environment has IPv6 DNS for Docker Hub but no working IPv6 egress; the daemon's
  own pulls work over IPv4, and removing the syntax directive avoids the BuildKit frontend fetch that
  failed on IPv6. No repo change is required to build elsewhere with full connectivity.

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

- **None.** Docker is installed, running, and reachable without sudo (session restarted after adding
  `hermes` to the `docker` group). The production image builds and runs. Remaining Phase 1 work is
  ordinary implementation/packaging/docs/CI/GHCR/live-integration — no privileged or manual step is
  blocking at this point.

## Environment notes (for a fresh chat)

- **Sudo access verified:** direct foreground `sudo` works through Hermes's secure masked password
  prompt in this environment (verified with `sudo id` → root). The earlier claim that sudo was
  unavailable due to the non-TTY environment is incorrect and has been superseded. Use direct
  foreground `sudo` for any future privileged step; never wrap it or handle the password yourself.
- **Docker:** installed by the agent via direct foreground `sudo`; daemon active (client/server
  26.1.5); `hermes` is in the `docker` group, so normal Docker operations need no sudo.

## Remaining Phase 1 work (correct order)

1. ~~Make Docker available in the Hermes environment~~ — completed (install + start/enable daemon;
   `hermes` added to `docker` group).
2. ~~Build & exercise the production image, then commit `Dockerfile` / `.dockerignore`~~ — completed:
   image built and live-exercised against the disposable VM; committed in `acc8051`.
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
- The production image has been built and live-exercised locally (`zimaos-mcp-server:local`), but it
  is not yet published to GHCR, so the Compose/CI references will use a local build until then.
- Live integration against the disposable VM: container round-trip verified (see Docker section);
  the broader live-integration pass (step 8) still pending.
- Pre-existing formatting/lint debt on 5 test files (2 eslint errors + 5 prettier files) — see above.

## Manual actions required

- **None blocking.** The Hermes/LXC session was restarted after `usermod -aG docker hermes`; the
  agent now has unprivileged Docker access and no further manual step is needed for packaging.
- A live ZimaOS Custom App paste/install may remain as one explicit manual verification item near the
  end (per PROJECT.md).

## Recommended next action for a fresh chat

Continue Phase 1 from `deploy/zimaos/docker-compose.yml` → CI workflow → GHCR publishing workflow →
docs (`README.md`, `LICENSE`, `.env.example`) → full local quality gates (fix the recorded
eslint/prettier debt first) → live integration against the disposable VM using
`.env.integration.local` (never echoed) → final manager handoff. Do not begin Phase 2.
