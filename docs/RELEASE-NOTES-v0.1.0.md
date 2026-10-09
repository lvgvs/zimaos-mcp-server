# ZimaOS MCP Server v0.1.0

ZimaOS MCP Server lets MCP-capable assistants inspect and manage ZimaOS Compose applications through supported ZimaOS APIs.

## Highlights

- Authenticated Streamable HTTP MCP access with a required operator-supplied bearer token; ZimaOS credentials stay on the server.
- Read-only inspection of apps, containers/services, app/container health, bounded recent logs, existing-app Compose and basic system information, plus non-mutating Compose validation.
- Independent, default-off permissions for start/stop/restart, Compose installation, exact-id uninstall and existing-app Compose editing.
- Existing-app edits use base fingerprints and optimistic-concurrency checks. Risk-increasing install/edit operations require modern MCP native approval, bound to the exact content, short-lived and single-use; risky legacy requests fail closed.
- Docker packaging with a non-root runtime user and ZimaOS Custom App Docker Compose/YAML deployment, with publicly accessible GHCR images and English/Turkish setup documentation.
- Validated configuration, secret-safe normalized errors and active upstream readiness checks. Ambiguous mutation outcomes are not automatically retried.

## Security and deployment

The server uses supported ZimaOS APIs, not SSH, arbitrary shell execution, the Docker socket, privileged server mode or direct internal-file/database mutation. No default authentication secret is supplied. Use a trusted LAN/VPN or a correctly configured HTTPS reverse proxy: bearer authentication does not encrypt plain HTTP traffic.

For exact deployments, pin an image digest. Version images promote an existing CI-published artifact without rebuilding; `edge` remains a development channel. See [installation and configuration](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.1.0/README.md#zimaos-installation).

## Important limitations

- `update_app` is not implemented; supported App Store update/version-transition semantics remain unverified.
- Asynchronous acceptance is not proof of completion. General edit rollback and exact uninstall storage retention are not guaranteed.
- ZimaOS exposes no atomic compare-and-swap for Compose edits; external writers can race with this server.
- Approval state and locks are process-local, not multi-replica coordination. The client must present the approval UI; MCP does not cryptographically prove human presence.
- Risky approval requires a compatible modern MCP client. Inspector Web must be opened from browser-local loopback or trusted HTTPS.
- Application-generated logs and Compose output may contain sensitive information.

External runtime UAT is complete on the recorded runtime candidate. Later documentation/metadata-only images are not claimed to have undergone repeated external runtime UAT. See the [changelog](https://github.com/lvgvs/zimaos-mcp-server/blob/main/CHANGELOG.md) for verified changes and limitations.
