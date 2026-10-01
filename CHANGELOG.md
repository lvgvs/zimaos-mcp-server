# Changelog

All notable user-facing changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and release versions follow [Semantic Versioning](https://semver.org/) unless the project explicitly documents otherwise.

## [Unreleased]

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

### Security

- Mutation permissions default to disabled.
- No SSH control plane, arbitrary shell execution, Docker socket, privileged server mode, or direct ZimaOS internal-file/database mutation.
- Ambiguous mutation outcomes are not automatically retried.
- Risky modern approval state is signed, short-lived, exact-content-bound, and single-use.

### Known limitations

- `update_app` is intentionally not implemented because supported App Store update/version-transition semantics remain unverified.
- Existing-app edit rollback is not guaranteed.
- ZimaOS does not expose an atomic compare-and-swap for Compose edits, so external writers can race with this server.
- Risky approval state and locks are process-local.
- Exact uninstall storage-retention semantics are not independently verified.

The first tagged release has not yet been published.
