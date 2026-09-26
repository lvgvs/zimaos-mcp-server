# Status

Phase 1 — ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Current phase / milestone

- **Phase:** Phase 1 — **complete.** All Phase 1 acceptance criteria that can be completed safely
  have been completed and verified. No Phase 2 work has been started.
- **Current milestone:** Final manager handoff. Production image built, live-exercised, published to
  GHCR; CI green on push; ZimaOS paste-ready Compose committed; docs complete; full local quality
  gates green; live integration against the disposable VM verified.

## Git / repository

- **Branch:** `main`
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server (**private**, per Phase 1 rule)
- **HEAD:** see `git log -1 --oneline`. Latest: `e612d91` (`docs(README): correct MCP tool list to
  match registered tools`).

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

## Automated test status (exact)

- **5 files / 52 tests — all passing** (mocked, no network). Re-verified this session: `vitest run`
  → "Test Files 5 passed", "Tests 52 passed".
- Suites: config, client session, permissions, tools (InMemoryTransport), HTTP transport.

## Full local quality gates — ALL PASSING (re-verified this session)

- `npm run lint` (`eslint .`) — **pass** (0 errors). The two pre-existing
  `consistent-type-imports` errors were fixed with `eslint --fix`.
- `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) — **pass**.
- Test type check (`tsc -p tsconfig.test.json --noEmit`) — **pass** (strict).
- `npm test` — **52/52 pass**.
- `npm run build` (`tsc -p tsconfig.json`) — **passes**; emits `dist/` (gitignored).
- `npx prettier --check .` — **pass** ("All matched files use Prettier code style!"). The 5-file
  formatting debt recorded in the previous status was fixed with `prettier --write`.

## Docker / packaging status

- **Docker availability:** installed and running in the Hermes environment (agent-installed via
  direct foreground `sudo`; daemon active, client/server 26.1.5). The session was restarted so
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

## CI status (GitHub Actions)

- **Workflow:** `.github/workflows/ci.yml` on push to `main`. Steps: install → lint → typecheck →
  test → production build → Docker image build → Compose validation (`docker compose config`).
- **Result:** run for the final push — **success** (all jobs green). CI does not depend on the
  disposable VM and contains no VM credentials.

## GHCR status

- **Workflow:** `.github/workflows/ghcr-publish.yml` on push to `main` (and `v*` tags), using the
  auto-provided `GITHUB_TOKEN`. No VM dependency.
- **Result:** run for the final push — **success**. Pushed image:
  `ghcr.io/lvgvs/zimaos-mcp-server:latest` (digest `sha256:0f8aeb93…`, per the workflow's "Push tags"
  log). The package inherits repository visibility (**private**); pulling requires a GitHub token
  with `read:packages` scope. This is documented in README ("Private-image limitation").

## Live integration status (authorized disposable VM)

- Executed against ZimaOS v1.7.1 using `.env.integration.local` (never echoed; file remains
  git-ignored and untracked).
- **Verified:** container `/health` readiness; authenticated MCP round-trip over Streamable HTTP —
  `tools/list` returned all 9 tools (`list_apps`, `get_app`, `get_app_health`, `get_app_logs`,
  `list_app_containers`, `get_system_info`, `start_app`, `stop_app`, `restart_app`);
  `get_system_info` returned real VM facts (hostname `ZimaOS`, v1.7.1, amd64); `list_apps` returned
  the VM's running test app (`mcp-test-nginx`, status `running`); unauthenticated `/mcp` request was
  rejected with **401** (negative control).
- Control operations remain disabled by default (`ALLOW_APP_CONTROL` unset), per Phase 1 security
  model; no destructive live actions were needed for verification.

## Documentation status

- Present: `AGENTS.md`, `PROJECT.md`, `DECISIONS.md`, `docs/RESEARCH.md`, `STATUS.md`, `README.md`,
  `LICENSE` (Apache-2.0), `.env.example`, `deploy/zimaos/docker-compose.yml`.
- README documents: setup, configuration (all env vars incl. `ALLOW_APP_CONTROL` default-off), the
  exact MCP tool list (verified against `src/mcp/tools.ts`), ZimaOS Custom App deployment via the
  paste-ready Compose, and the private-image pull limitation.

## Secrets / integration env file

- `.env.integration.local` is **ignored** (`.gitignore:9:.env.*`), **untracked**, and **unstaged**.
  No secrets are committed or staged. Its values must never be printed, logged, or copied into
  tracked files. Verified with `git check-ignore -v .env.integration.local` → ignored.

## Known limitations

- GHCR image is private (inherits repo visibility); consumers need a token with `read:packages`.
  Documented in README; no action required for Phase 1 scope.
- A live ZimaOS Custom App paste/install through the ZimaOS UI remains an optional manual
  verification item near handoff (per PROJECT.md); the Compose file is validated by CI and is
  paste-ready, but was not pasted into the VM's UI in this session.

## Manual actions required

- **None blocking.** No privileged or manual step is needed for Phase 1 completion.
- Optional: paste `deploy/zimaos/docker-compose.yml` into a ZimaOS Custom App on the disposable VM
  as an end-to-end UI verification (the container artifact itself is already verified).

## Recommended next action for the manager

Phase 1 is complete and pushed; review the handoff. No Phase 2 work has been started, per scope
discipline. If approved, a later phase may consider: public repository visibility decision, GHCR
image tag strategy beyond `latest`, and additional ZimaOS API coverage — none of which are in
Phase 1 scope.
