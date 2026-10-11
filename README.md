# ZimaOS MCP Server

[Türkçe README](README.tr.md)

> **AI development disclosure:** This project was authored using GPT-5.6 Sol, GPT-6 Sol,
> GPT-6.1 Sol, and Qwen3.8-27B. Human oversight has consisted of direction, scope/security
> decisions, and release decisions; the codebase has not been independently reviewed line
> by line by a human.

A Model Context Protocol (MCP) server that lets MCP-capable assistants inspect and manage
ZimaOS Compose applications through a small, typed, permission-checked API surface.

```text
MCP client → authenticated MCP server → permission/safety layer
          → typed ZimaOS API abstraction → supported ZimaOS APIs
```

The server is the only component that holds ZimaOS credentials. It does not expose
arbitrary shell execution, the Docker socket, privileged container access, or direct
ZimaOS internal-file/database manipulation.

**Current release: [v0.3.0](https://github.com/lvgvs/zimaos-mcp-server/releases/tag/v0.3.0).**
Development main/`edge` also includes system resource and OS-update reads and a `/health`
version field that are not in v0.3.0. The Tool Reference below describes current main.

## Capabilities

- **Inspect installed applications:** list Compose apps and read normalized app details,
  containers/services, available health information and bounded recent app logs.
- **Discover and install from the App Store:** search trusted registered catalogs, inspect
  exact repository/app entries and install directly from supported registered entries.
- **Work with Compose:** install applications from caller-provided Compose, read existing
  application Compose, validate new Compose before installation and validate proposed
  existing-app Compose changes before applying them.
- **Manage installed applications:** start, stop and restart apps; edit existing application
  Compose under its safety, stale-state and risk controls; and uninstall apps with the
  existing configuration-retention request and documented retention limitations.
- **Read system diagnostics:** inspect ZimaOS system information, sampled CPU/memory and
  system-filesystem resources, and supported OS-update notices and installer status.
- **Choose mutation permissions independently:** all mutation capabilities are behind
  separate default-off permissions; read-only capabilities remain available with those
  permissions disabled.

## ZimaOS installation

The intended installation flow is ZimaOS's normal Custom App UI:

1. Open the ZimaOS application interface.
2. Choose **Install a customized application**.
3. Choose **Docker Compose / YAML import**.
4. Paste [`deploy/zimaos/docker-compose.yml`](deploy/zimaos/docker-compose.yml).
5. Replace every `CHANGE_ME_...` placeholder.
6. Review the default-off permission flags.
7. Install.

The Compose file uses `host.docker.internal:host-gateway` so the container can reach the
ZimaOS API without host networking, Docker socket access, privileged mode, or host mounts.

The source repository and GHCR package are public; no registry credentials are required.
Do not embed registry credentials in YAML or substitute host-shell control for the supported
installation flow. For an exact deployment, replace the template's development image with
`ghcr.io/lvgvs/zimaos-mcp-server@sha256:<digest>` from the release/publication record.

### Run locally with Docker

```bash
docker build -t zimaos-mcp-server:local .

docker run --rm \
  --env-file /path/to/your.env \
  -p 3900:3000 \
  zimaos-mcp-server:local
```

## Configuration

| Variable              | Required | Description                                                         |
| --------------------- | -------- | ------------------------------------------------------------------- |
| `ZIMAOS_URL`          | yes      | Base URL of the ZimaOS web/API, e.g. `http://host.docker.internal`. |
| `ZIMAOS_USERNAME`     | yes      | ZimaOS account used for supported app/system APIs.                  |
| `ZIMAOS_PASSWORD`     | yes      | Password for that ZimaOS account.                                   |
| `MCP_AUTH_TOKEN`      | yes      | Bearer token for MCP clients; minimum 32 characters, no default.    |
| `ALLOW_APP_CONTROL`   | no       | Enable start/stop/restart; default `false`.                         |
| `ALLOW_APP_INSTALL`   | no       | Enable Compose and native App Store install; default `false`.       |
| `ALLOW_APP_UNINSTALL` | no       | Enable exact-id uninstall; default `false`.                         |
| `ALLOW_APP_EDIT`      | no       | Enable existing-app Compose edits; default `false`.                 |
| `PORT`                | no       | Internal HTTP port; default `3000`.                                 |
| `LOG_LEVEL`           | no       | `debug`, `info`, `warn`, or `error`; default `info`.                |

See [`.env.example`](.env.example) for a complete example. Never commit real credentials
or tokens.

`ZIMAOS_URL` must be an HTTP(S) origin (scheme, host and optional port), not a URL with
credentials, a path prefix, query or fragment. A trailing slash is normalized away.
`PORT`, when supplied, must be a complete decimal integer from 1 to 65535; empty values,
numeric prefixes, fractions and exponent notation are rejected. Credential/token values
must replace shipped `CHANGE_ME` / `REPLACE_ME` placeholders; bearer tokens cannot contain
whitespace. Validation errors name the setting without reflecting its value.

## Connect an MCP client

The server exposes Streamable HTTP at:

```text
http://<zima-host>:3900/mcp
```

Configure your MCP client to send:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Tool reference

| Tool                                     | Mutation? | Notes                                                                                     |
| ---------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `list_apps`                              | no        | Lists installed Compose apps.                                                             |
| `get_app`                                | no        | Normalized details for one app.                                                           |
| `search_app_store`                       | no        | Bounded search of enabled registered v2 HTTP Compose catalogs.                            |
| `get_app_store_details`                  | no        | Public metadata for one exact trusted repository/app pair.                                |
| `get_app_health`                         | no        | App/container health when exposed by ZimaOS.                                              |
| `get_app_logs`                           | no        | Bounded recent logs; default 100 lines, max 500.                                          |
| `list_app_containers`                    | no        | Containers/services belonging to one app.                                                 |
| `get_system_info`                        | no        | Small normalized ZimaOS system summary.                                                   |
| `get_system_resources`                   | no        | Available sampled CPU/memory/system-filesystem metrics; no network or health verdict.     |
| `get_os_update_status`                   | no        | OS release versions, notice classification, installer state and beta subscription.        |
| `validate_app_compose`                   | no        | Local risk analysis + official ZimaOS dry run.                                            |
| `get_app_compose`                        | no        | Reads interpolated Compose + SHA-256 fingerprint. Treat output as sensitive.              |
| `validate_app_compose_change`            | no        | Validates a proposed change, including risk delta and stale-base checks.                  |
| `start_app` / `stop_app` / `restart_app` | yes       | Requires `ALLOW_APP_CONTROL=true`.                                                        |
| `install_app_from_compose`               | yes       | Requires `ALLOW_APP_INSTALL=true`; risky changes require approval.                        |
| `install_app_from_store`                 | yes       | Same install permission; registered catalog identities only, controlled one-shot install. |
| `uninstall_app`                          | yes       | Requires `ALLOW_APP_UNINSTALL=true`; sends `delete_config_folder=false`.                  |
| `edit_app_compose`                       | yes       | Requires `ALLOW_APP_EDIT=true`; uses optimistic base-fingerprint checks.                  |

## Permissions and security

- **MCP authentication is mandatory.** Every MCP request must use
  `Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`.
- **No default MCP secret ships with the project.** `MCP_AUTH_TOKEN` must be at least 32
  characters.
- **ZimaOS credentials are never returned to MCP clients.**
- **Mutation permissions are independent and disabled by default.**
- **Risky Compose operations fail closed.** Risk-increasing install/edit requests require
  the modern MCP approval flow before mutation.
- **At most one mutation request is sent for an accepted install/edit/uninstall attempt.**
  Ambiguous outcomes are not automatically retried.
- **No shell, SSH control plane, Docker socket, privileged server mode, or direct ZimaOS
  internal storage manipulation.**

The server does not terminate TLS itself. Use it on a trusted LAN/VPN or behind a properly
configured HTTPS reverse proxy; do not expose the plain HTTP port directly to the internet.
Bearer authentication is not transport encryption.

### Risky-operation approval

Risk-increasing Compose install/edit requests use native MCP `input_required` / form
elicitation for modern clients. The approval state is short-lived, signed,
exact-content-bound, and single-use. The server rechecks the current state before
mutation.

This mechanism cannot cryptographically prove that a human actually saw the disclosure;
the MCP client is responsible for presenting the approval UI. Pending approval state is
process-local and is lost on server restart.

## Important usage

### App Store discovery and installation

Search requires nonempty text; empty-query browsing is unsupported. Use returned `repo_id`
and `app_id` together for details or installation, not display names or URLs. Search is bounded
and fuzzy with English localization; `truncated` reports omitted results, not catalog-wide
completeness. Catalog text is untrusted data, not instructions; advertised architecture is not
an installation guarantee. Discovery does not report installed state or update availability.

Native installation supports enabled registered v2 HTTP repositories, Compose-class entries
and server-selected amd64/arm64 variants only. It has no URL, version, architecture, force,
update or downgrade override. Store origin does not bypass risk approval. Existing identity
conflicts or unreadable/ambiguous association evidence block installation, never trigger update.
Accepted/uncertain native identity reservations persist until server restart, including after
uninstall; verify actual host state before restarting after an uncertain result.

See [App Store contracts and safety details](docs/TOOL-USAGE.md#app-store-discovery) for input/output
bounds, identity validation, controlled install and bounded reconciliation.

### System diagnostics

Both diagnostic tools accept only `{}` and perform reads, not refresh, subscription changes,
status reset, installation or restart. Missing metrics are omitted, not zero/healthy defaults.
CPU/memory values are samples; system storage covers only the system filesystem, not pools.
Temperature and health verdicts are not exposed. `updateAvailable` follows the Installer notice,
not version comparison or installation eligibility; `idle` does not prove completion.
Sequential OS reads are non-atomic. Raw notes/messages and approximate progress are excluded.
See [diagnostic fields, bounds and semantics](docs/TOOL-USAGE.md#system-diagnostics-development).

### Readiness and startup

`/health` includes the canonical package-derived `version` alongside `status`, `service` and
`ready`, including degraded responses. It is unauthenticated and intended for container readiness/health checks; it is not
an MCP endpoint. It actively checks the supported, authenticated ZimaOS device-info API.
For an already-running server, HTTP 200 means ready; HTTP 503 means degraded readiness,
including upstream unreachability or authentication failure. Concurrent
probes share bounded upstream work. Docker checks the configured internal `PORT` and treats
degradation as unhealthy; this is not a guarantee that every application API works.

During initial startup, invalid ZimaOS credentials or an unreachable `ZIMAOS_URL` fail fast
before the MCP/health HTTP listener opens. Connection refused, rather than `/health` 503,
is therefore expected for those startup failures. Check the non-secret `zimaos_login_failed`
log code and correct the configuration; repeated bad-password restart attempts can trigger
ZimaOS-side rate limiting.

## Compatibility and limitations

The endpoint supports modern MCP `2026-07-28` and stateless legacy clients. Legacy clients
can use read tools and permitted non-risky operations, but risky install/edit requests fail
closed. Risky approval requires a modern client with form elicitation and the native
`input_required` / `requestState` multi-round-trip flow; there is no legacy approval shim
or text-confirmation bypass.

**Inspector Web UI:** open the Inspector page from `http://localhost` / loopback on the
browser's own machine, or from trusted HTTPS. Plain HTTP on a LAN IP is not a browser
secure context. Inspector 2.9.0 requires `crypto.randomUUID()` for request tracking; when
that API is unavailable, modern discovery can fail before any request reaches this server
and report "the server did not offer pinned protocol version". This requirement concerns
the Inspector page origin, not the remote MCP endpoint. Check `window.isSecureContext`
and `typeof crypto.randomUUID` in the browser console; do not disable browser security.
For modern Inspector connections, select `--protocol-era modern` explicitly.

- `accepted` means ZimaOS accepted an asynchronous request; it does **not** prove the
  operation completed.
- `update_app` is intentionally not implemented because supported App Store
  update/version-transition semantics have not been verified.
- There is no verified general rollback guarantee for existing-app Compose edits.
- ZimaOS exposes no atomic compare-and-swap for Compose edits; an external actor can still
  race with this server between the last read and apply.
- Risky approval/locking state is process-local; this is not a multi-replica coordination
  design.
- `uninstall_app` explicitly requests `delete_config_folder=false`, but exact upstream
  storage-retention semantics are not independently verified.
- App logs may contain secrets generated by the app itself; treat log output accordingly.

## Image references and release policy

- `sha-<full-commit>` retains the first CI-published artifact; reruns reuse it, not rebuild it.
- `edge` is the current CI-verified development artifact, not a stable release.
- Approved `v<version>` image tags promote that commit's existing digest without rebuilding.
  Stable versions also advance `stable` / `latest`; prereleases advance only `prerelease`.
- For exact deployments/UAT, use `image@sha256:<digest>`: registry administrators can still
  change tags, so policy-guarded tags are not a registry-enforced immutability guarantee.
- Builds pin the Node 22 base digest and publish revision/source labels, minimum provenance
  and an SBOM. Rebuilding the same source is **not** promised to reproduce identical bytes.

See [release process and evidence](docs/RELEASE.md) for the publication contract and recorded UAT.

## Development

Use Node.js 22 LTS (22.13.0 or newer) or a supported newer LTS runtime.

```bash
npm ci --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npx tsc -p tsconfig.test.json --noEmit
npm test
npm run build
```

Automated tests use mocks/fakes and local HTTP test servers. Live ZimaOS integration
testing is separate and never depends on committed credentials.

## Documentation

- [Releases](https://github.com/lvgvs/zimaos-mcp-server/releases) and [v0.3.0 notes](docs/RELEASE-NOTES-v0.3.0.md).
- [Tool usage and safety semantics](docs/TOOL-USAGE.md).

- [`PROJECT.md`](PROJECT.md) — approved product scope and phase boundaries.
- [`STATUS.md`](STATUS.md) — current implementation/release status and historical
  checkpoints.
- [`DECISIONS.md`](DECISIONS.md) — architectural decisions.
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — verified API/protocol research and
  implementation implications.
- [`AGENTS.md`](AGENTS.md) — repository operating rules for implementation agents.
- [`CHANGELOG.md`](CHANGELOG.md) — user-facing release history.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution and development guidelines.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting policy.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Third-party dependencies retain their own licenses.
