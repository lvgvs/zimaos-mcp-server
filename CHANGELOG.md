# Changelog

All notable user-facing changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and release versions follow [Semantic Versioning](https://semver.org/) unless the project explicitly documents otherwise.

## [Unreleased]

## [0.2.0] - 2026-10-10

### Added

- Native `install_app_from_store` for exact registered repository/catalog identities and verified
  architecture-selected Compose, sharing default-off `ALLOW_APP_INSTALL`, exact-final-content
  modern approval and one-shot controlled installation with bounded acceptance readback.
- Fail-closed installed native-association checks and process-local catalog-identity reservations;
  internal identity-only Compose projection without exposing unrelated interpolated credentials.

### Fixed

- Bounded whole-body timeout and redirect rejection for existing-app Compose/association reads.

## [0.1.0] - 2026-10-09

### Added

- Authenticated Streamable HTTP MCP server for supported ZimaOS APIs.
- Read-only app, container, log, health, Compose, and basic system inspection tools.
- Independently gated app start/stop/restart controls.
- Compose validation and independently gated app installation.
- Modern single-use approval flow for risk-increasing Compose installation.
- Independently gated exact-id app uninstall.
- Existing-app Compose read, validation, optimistic-concurrency editing, and risk-delta approval flow.
- Docker image and ZimaOS Custom App Compose deployment.
- English and Turkish public README documentation.
- CI-gated first-artifact commit images, digest-only version promotion, development `edge`,
  and policy-managed stable/prerelease aliases with provenance and SBOM.

### Fixed

- Strict decimal `PORT` validation and origin-only, secret-safe `ZIMAOS_URL` validation.
- Active ZimaOS readiness: HTTP 503 for degradation, bounded shared probes and configured-port
  Docker health checks rather than cached-session-only readiness.
- Normalized startup/listener, response-body and upstream errors without free-form secret reflection.

### Security

- Regex-free, linear bearer Authorization parsing replaces ambiguous backtracking while
  preserving case-insensitive scheme handling, existing syntax and timing-safe token comparison.
- Mutation permissions default to disabled.
- No SSH control plane, arbitrary shell execution, Docker socket, privileged server mode, or direct ZimaOS internal-file/database mutation.
- Ambiguous mutation outcomes are not automatically retried.
- Risky modern approval state is signed, short-lived, exact-content-bound, and single-use.
- Shipped credential/token placeholders and whitespace-bearing MCP tokens are rejected.
- Supported ESLint 10 and patched test dependencies; runtime and full dependency audits passed
  at the release-hardening checkpoint (not a permanent vulnerability-free guarantee).

### Verification checkpoint

- Phase 4 manager-run external runtime UAT completed on the source tree now reachable as
  `c66254b218afd9436e5931e66518ece88ff58c5e` and the unchanged tested digest in `docs/RELEASE.md`:
  fresh Custom App install/clean reinstall, modern discovery/read/control/install/uninstall,
  benign edit, risky modern approval/MRTR continuation and repair, authentication/network
  failure modes, candidate upgrade, and app/VM restart persistence passed.
- Initial ZimaOS login failures occur before HTTP listening (connection refused); HTTP 503
  readiness applies to an already-running server. Inspector Web requires a secure page origin
  (browser-local loopback or trusted HTTPS), not a server-side protocol workaround.
- Runtime acceptance and release publication identify separate evidence; a docs-only
  follow-up image is not claimed to have undergone repeated external runtime UAT.

### Known limitations

- `update_app` is intentionally not implemented because supported App Store update/version-transition semantics remain unverified.
- Existing-app edit rollback is not guaranteed.
- ZimaOS does not expose an atomic compare-and-swap for Compose edits, so external writers can race with this server.
- Risky approval state and locks are process-local.
- Exact uninstall storage-retention semantics are not independently verified.
