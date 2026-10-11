# ZimaOS MCP Server v0.3.0

v0.3.0 adds authenticated, read-only App Store discovery to the existing ZimaOS application-management tool surface. All v0.2.0 capabilities remain included, including native `install_app_from_store`.

## Highlights

- `search_app_store` searches currently enabled registered v2 HTTP Compose catalogs using a required nonempty query and an optional limit of 1–50 (default 20). Results contain exact `repo_id` / `app_id` identities and available public summary metadata.
- `get_app_store_details` looks up one exact repository/app pair and returns bounded public metadata, including available description, advertised architectures and release notes.
- Discovery identities use the same selection contract as `install_app_from_store`. Discovery does not install anything or establish installation eligibility; the installer independently revalidates current trust, architecture and safety requirements.
- Search sorts a bounded relevance window of at most 300 upstream matches by identity before applying the limit and reports truncation explicitly. Failed repositories, inconsistent pages, malformed identities and credential-bearing selected metadata fail closed.

## Security and deployment

Both new tools require MCP authentication, work with every mutation permission disabled and perform only supported reads plus authentication. They accept no arbitrary repository/Compose URL and expose no raw Compose, configuration or source URLs. Catalog descriptions are untrusted content, not instructions.

Existing mutation permissions remain independently disabled by default. Risk-increasing installation/editing still requires compatible modern signed, expiring, single-use exact-content approval; legacy risky requests fail closed. ZimaOS credentials remain server-side. There is no SSH control plane, arbitrary shell, Docker socket or privileged server mode.

Use a trusted LAN/VPN or correctly configured HTTPS reverse proxy; bearer authentication does not encrypt plain HTTP. Pin the released image digest for exact deployments. Release image promotion reuses the existing CI artifact without rebuilding, preserving provenance and SBOM. See [installation](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.3.0/README.md#zimaos-installation).

## Known limitations

- `update_app` remains unavailable: Phase 5 is ON HOLD / Outcome B DEFER. No update UAT or update-availability detection is part of this release.
- Search requires a nonempty query, uses fixed English localization and is not exhaustive catalog browsing or a catalog-wide ordering guarantee.
- Discovery provides no installed-state, update-availability or installation-compatibility verdict. Advertised architectures are metadata only.
- Phase 8 system diagnostics/management, OS update/restart tools, network diagnostics, system logs/notifications, Files and later capabilities are not included.
- Approval state, locks and reservations are process-local; asynchronous acceptance is not completion. General rollback, upstream atomic compare-and-swap and exact uninstall storage retention are not guaranteed. External writers can race with the server.
- Application-generated logs and Compose output can contain sensitive information. Modern approval depends on a compatible client presenting the UI; MCP does not cryptographically prove human presence.

See the [changelog](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.3.0/CHANGELOG.md) and [release contract](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.3.0/docs/RELEASE.md). Git tags, GitHub Releases and GHCR readback are authoritative for publication state and exact-candidate verification.
