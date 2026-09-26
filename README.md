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

Phase 1 implementation: read-only system info + compose app listing/inspection,
plus reversible start/stop/restart controls (disabled by default). See
`STATUS.md` for the current milestone and `PROJECT.md` for scope.

## Security model

- **MCP authentication is required.** Every request must carry
  `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`. There is no
  universal/default token; the server refuses to start if the token is missing
  or shorter than 32 characters.
- **ZimaOS credentials are never returned** to MCP clients in any response.
- **Read vs control separation.** Control operations (`start_app`, `stop_app`,
  `restart_app`) are disabled unless `ALLOW_APP_CONTROL=true`.
- **No shell, no Docker socket, no privileged mode.** The product talks only to
  supported ZimaOS APIs over HTTP.

## Configuration (environment)

| Variable            | Required | Description                                                          |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `ZIMAOS_URL`        | yes      | Base URL of the ZimaOS web/API, e.g. `http://host.docker.internal`.  |
| `ZIMAOS_USERNAME`   | yes      | ZimaOS account allowed to manage compose apps and read system info.  |
| `ZIMAOS_PASSWORD`   | yes      | Password for that account.                                           |
| `MCP_AUTH_TOKEN`    | yes      | Bearer token MCP clients must present; **min 32 chars, no default**. |
| `ALLOW_APP_CONTROL` | no       | `true`/`false`; enable reversible app controls (default `false`).    |
| `PORT`              | no       | HTTP listen port (default `3000`).                                   |
| `LOG_LEVEL`         | no       | `debug` \| `info` \| `warn` \| `error` (default `info`).             |

A ready-to-edit example lives in `.env.example`. Never commit real values.

## MCP tools

Read-only (always available):

- `list_apps` — installed compose applications with status.
- `get_app` — normalized details for one application by its stable id.
- `get_app_health` — health/state for an application and its containers (`unknown` when ZimaOS does not expose it).
- `get_app_logs` — bounded recent logs for one application (default 100 lines, max 500).
- `list_app_containers` — normalized container/service info for one application.
- `get_system_info` — ZimaOS version, hostname, and basic system facts.

Control operations (only when `ALLOW_APP_CONTROL=true`; otherwise a clear permission error):

- `start_app`, `stop_app`, `restart_app`.

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
