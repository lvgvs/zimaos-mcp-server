# zimaos-mcp-server

A Model Context Protocol (MCP) server that lets an AI assistant manage ZimaOS
compose applications through a small, typed, permission-checked API surface.

```text
MCP client → authenticated MCP server → permission/safety layer
          → typed ZimaOS API abstraction → supported ZimaOS APIs
```

The server is the only component that holds ZimaOS credentials. It never returns
them to MCP clients, and it does not expose arbitrary shell execution, Docker
socket access, or privileged operations.

## Status

Phase 1 read and reversible control tools remain available. Phase 2C adds
non-mutating Compose validation and default-off safe Compose installation.
Phase 2D adds a modern-only, single-use risky-install approval flow.
Phase 2E adds separately gated uninstall by exact listed app id. See
`STATUS.md` for the current milestone and `PROJECT.md` for scope.
Phase 3B adds read-only existing-app Compose inspection and change validation;
editing remains unavailable until the independently gated Phase 3C/3D work.

## Security model

- **MCP authentication is required.** Every request must carry
  `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`. There is no
  universal/default token; the server refuses to start if the token is missing
  or shorter than 32 characters.
- **ZimaOS credentials are never returned** to MCP clients in any response.
- **Read vs control separation.** Control operations (`start_app`, `stop_app`,
  `restart_app`) are disabled unless `ALLOW_APP_CONTROL=true`.
- **Install authority is separate.** `install_app_from_compose` requires
  `ALLOW_APP_INSTALL=true` (default `false`). Risky Compose returns findings
  without installing on the first request; validation grants no install authority.
- **Uninstall authority is separate.** `uninstall_app` requires
  `ALLOW_APP_UNINSTALL=true` (default `false`), accepts only an explicit listed
  id, and sets `delete_config_folder=false` on its one DELETE request. The
  actual effects on configuration files or volumes have not been verified.
- **Risky approval is modern-only.** A client must negotiate MCP 2026-07-28,
  declare form elicitation support, show the disclosed findings to a human, and
  return an accepted `confirm: true` response with the exact signed request state
  within 300 seconds. The server rechecks permission, source, risk, duplicate
  identity and upstream dry run before consuming a single-use challenge and
  attempting one POST. Legacy clients fail closed on risky installs. A protocol
  response does not cryptographically prove human presence: the client must
  enforce the human stop. Process restart invalidates pending approvals.
- **No shell, no Docker socket, no privileged mode.** The product talks only to
  supported ZimaOS APIs over HTTP.

## Configuration (environment)

| Variable              | Required | Description                                                          |
| --------------------- | -------- | -------------------------------------------------------------------- |
| `ZIMAOS_URL`          | yes      | Base URL of the ZimaOS web/API, e.g. `http://host.docker.internal`.  |
| `ZIMAOS_USERNAME`     | yes      | ZimaOS account allowed to manage compose apps and read system info.  |
| `ZIMAOS_PASSWORD`     | yes      | Password for that account.                                           |
| `MCP_AUTH_TOKEN`      | yes      | Bearer token MCP clients must present; **min 32 chars, no default**. |
| `ALLOW_APP_CONTROL`   | no       | `true`/`false`; enable reversible app controls (default `false`).    |
| `ALLOW_APP_INSTALL`   | no       | `true`/`false`; enable safe Compose install (default `false`).       |
| `ALLOW_APP_UNINSTALL` | no       | `true`/`false`; enable exact-id uninstall (default `false`).         |
| `PORT`                | no       | HTTP listen port (default `3000`).                                   |
| `LOG_LEVEL`           | no       | `debug` \| `info` \| `warn` \| `error` (default `info`).             |

A ready-to-edit example lives in `.env.example`. Never commit real values.

## MCP tools

Read-only (always available):

- `list_apps` — installed compose applications with status.
- `get_app` — normalized details for one application by its stable id.
- `get_app_health` — health/state for an application and its containers (`unknown` when ZimaOS does not expose it).
- `get_app_logs` — bounded recent logs for one application (default 100 lines, max 500).
- `list_app_containers` — normalized container/service info for one application.
- `get_system_info` — ZimaOS version, hostname, and basic system facts.
- `validate_app_compose` — local risk analysis and ZimaOS dry run, without installation.
- `get_app_compose` — read the bounded, interpolated (not original stored) YAML
  for an existing app and SHA-256 fingerprint of the returned exact bytes. Treat
  the response as sensitive; known ZimaOS credential-bearing content is refused.
- `validate_app_compose_change` — supply exact existing app id, base fingerprint
  and proposed UTF-8 Compose source. Returns structural changes, current/proposed
  findings, unchanged/removed/new/escalated risk, and official existing-app PUT
  dry-run/port check. It rejects stale bases and project renames; never applies.
  The fingerprint is of the interpolated GET representation, so read after every
  edit. A dry-run result neither grants edit authority nor guarantees later apply.

Control operations (only when `ALLOW_APP_CONTROL=true`; otherwise a clear permission error):

- `start_app`, `stop_app`, `restart_app`.

Installation (only when `ALLOW_APP_INSTALL=true`, independent of app control):

- `install_app_from_compose` — requires a safe explicit top-level `name:`,
  checks duplicates and host dry run/port conflicts, then sends at most one
  exact-source install POST for a benign document. An `accepted` response means
  asynchronous acceptance, **not** completed installation. Elevated-risk
  findings produce a native modern `input_required` form on the first round,
  with no mutation. Only a signed and single-use post-disclosure continuation
  may attempt installation. A bounded read-only observation reports `pending`
  or `observed` after acceptance; neither establishes completion. Do not retry
  an uncertain install without checking host state.

Uninstall (only when `ALLOW_APP_UNINSTALL=true`, independent of install/control):

- `uninstall_app` — accepts an exact stable id from `list_apps`, performs one
  explicit `delete_config_folder=false` DELETE, and never retries it. `accepted`
  means asynchronous acceptance, not completion. A single read-only observation
  reports `pending` or `absent`; a stale list or read failure is `pending`.

## Running locally (Docker)

```bash
# Build the production image.
docker build -t zimaos-mcp-server:local .

# Run it, injecting your own environment (never commit real values).
docker run --rm \
  --env-file /path/to/your.env \
  -p 3900:3000 \
  zimaos-mcp-server:local
```

The container listens on internal port `3000` and exposes a readiness endpoint
at `/health` (no auth required). The server fails fast at startup if any
required variable is missing or invalid.

## Connecting an MCP client

The server speaks **Streamable HTTP** over a single endpoint:

```text
http://<zima-host>:3900/mcp
```

Every request must carry the bearer token configured as `MCP_AUTH_TOKEN` on
the server (no default value exists):

```http
POST /mcp HTTP/1.1
Host: <zima-host>:3900
Content-Type: application/json
Authorization: Bearer <MCP_AUTH_TOKEN>

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

This is transport-level, so any MCP client that supports Streamable HTTP can
connect — configure the endpoint URL and a static `Authorization` header in
your client of choice (e.g. Claude Desktop, an IDE MCP integration, or your
own SDK). The `/health` endpoint requires no authentication and is intended
for container health checks only; it is not an MCP endpoint.

## GHCR image references

Published images carry these tags:

| Tag                | Meaning                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `latest`           | Latest build pushed to `main` (and every release tag).                                           |
| `v<version>`       | A specific release, e.g. `v1.0.0`, when a `v*` git tag is pushed.                                |
| `sha-<GITHUB_SHA>` | **Immutable** reference for the exact commit that was built; every published build receives one. |

Pin deployments to `sha-<full-commit-sha>` (visible in the GHCR publish
workflow run) when you need a reproducible image; use `latest` or a `v*` tag
when tracking releases is sufficient. The package remains private, so pulling
requires a GitHub token with `read:packages`.

## ZimaOS Custom App deployment

1. Open the ZimaOS application interface.
2. Choose **install a customized application**.
3. Choose **Docker Compose / YAML import**.
4. Paste `deploy/zimaos/docker-compose.yml`.
5. Replace every placeholder (see the comments in that file).
6. Install.

The Compose uses `extra_hosts: ["host.docker.internal:host-gateway"]` so the
container reaches this host's ZimaOS API — no host networking mode, no Docker
socket, and no privileged mode are used.

### Private-image limitation (initial development)

During initial private development the GHCR package is not anonymously
pullable, so a fresh ZimaOS install cannot `docker pull` it yet. Until the
package is published, build the image on the target host first:

```bash
# On the ZimaOS host (or any machine with Docker + this repo):
git clone <your-private-repo-url> zimaos-mcp-server
cd zimaos-mcp-server
docker build -t ghcr.io/<owner>/zimaos-mcp-server:latest .
```

Then install the Compose as above; it will use the locally built image. Once
the package is published to GHCR, the same Compose works without a local build.

## Development

```bash
npm ci --no-audit --no-fund   # install dependencies (lockfile present)
npm run lint                   # eslint
npm run typecheck              # tsc strict
npm test                       # vitest (mocked; no VM required)
npm run build                  # production build -> dist/
```

Tests use mocks/fakes and a local test HTTP server. Live integration against the
authorized disposable ZimaOS VM is separate and never runs in CI.

## License

Apache-2.0 — see `LICENSE`. Third-party components retain their own licenses;
see `docs/RESEARCH.md` for dependency/license findings.
