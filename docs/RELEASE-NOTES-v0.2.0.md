# ZimaOS MCP Server v0.2.0

ZimaOS MCP Server lets MCP-capable assistants inspect and manage ZimaOS Compose applications through supported ZimaOS APIs. v0.2.0 adds native App Store installation to the existing authenticated, permission-checked tool surface.

## Highlights

- New `install_app_from_store` tool selects an application using only exact `repo_id` and `app_id` identities, not arbitrary repository or Compose URLs.
- Native installation supports registered enabled v2 HTTP repositories and verified Compose-class catalog entries. The server selects the trusted `amd64` or `arm64` Compose variant from its own architecture; callers cannot select architecture or version.
- The same independent, default-off `ALLOW_APP_INSTALL` permission gates both generic Compose and native App Store installation. Trusted catalog provenance does not bypass Compose risk analysis.
- Risky native installs require compatible modern MCP exact-final-content, signed, short-lived, single-use approval. Final canonical association bytes are consistently analyzed, dry-run validated, approved and submitted.
- Fail-closed installed-association checks, shared install serialization and process-local catalog-identity reservations reject conflicting or ambiguous native identities. An internal identity-only Compose projection avoids exposing unrelated interpolated credentials.
- Controlled installation explicitly uses `uncontrolled=false` and at most one real mutation attempt, with no ambiguous retry. Asynchronous acceptance is not completion; immediate bounded readback reports only `observed`, `pending` or `unknown` evidence.
- Existing-app Compose/association reads now enforce bounded whole-body timeouts and reject redirects.

## Security and deployment

MCP authentication remains mandatory, ZimaOS credentials stay on the server, and mutation permissions remain independently disabled by default. The server uses supported ZimaOS APIs, not SSH, arbitrary shell execution, the Docker socket, privileged server mode or direct internal-file/database mutation. No default authentication secret is supplied. Use a trusted LAN/VPN or a correctly configured HTTPS reverse proxy: bearer authentication does not encrypt plain HTTP traffic.

For exact deployments, pin an image digest. Version images promote an existing CI-published artifact without rebuilding; `edge` remains a development channel. See [installation and configuration](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.2.0/README.md#zimaos-installation).

## Important limitations

- `update_app` remains unimplemented. Phase 5 is ON HOLD / Outcome B DEFER; release work does not resume update implementation or update UAT.
- Native store support is intentionally restricted to the verified initial scope above. There is no App Store discovery tool, arbitrary catalog/Compose URL, force, update or downgrade option.
- Approval state, locks and reservations are process-local, not durable or multi-replica coordination. Accepted or uncertain native reservations can persist until server restart, including after uninstall; reconcile the actual host state before recovery.
- Asynchronous acceptance and bounded immediate observations do not guarantee completed installation. General rollback, cross-process/upstream atomic compare-and-swap and exact uninstall storage retention are not guaranteed; external writers can race with this server.
- Risky approval requires a compatible modern MCP client. Risk-increasing legacy requests fail closed; there is no text-confirmation or legacy approval bypass. Clients must present the approval UI; MCP does not cryptographically prove human presence. Inspector Web requires browser-local loopback or trusted HTTPS.
- Prior Phase 6 live UAT covered benign native installation, readback, duplicate denial and cleanup. Risky native-store approval and `arm64` were covered by mocked/MCP verification, not prior live Phase 6 UAT. Exact-digest release-UAT coverage belongs in the release verification record, not an invented source-document result.
- Application-generated logs and Compose output may contain sensitive information.

See the [changelog](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.2.0/CHANGELOG.md) for changes and the [release process and historical evidence](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.2.0/docs/RELEASE.md) for the publication contract. Git tags, GitHub Releases and GHCR readback are authoritative for publication state.
