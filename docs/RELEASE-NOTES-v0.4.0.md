# ZimaOS MCP Server v0.4.0

v0.4.0 adds system diagnostics and a guarded device-restart request to the authenticated ZimaOS application-management surface. All previous capabilities remain included; the public tool inventory is now **21 tools**.

## Highlights

- `get_system_resources` reads available sampled CPU, memory and system-filesystem counters. Missing or ambiguous measurements are omitted; it is not a network, temperature, disk-management or overall-health verdict.
- `get_os_update_status` reads supported release versions, update-notice classification, installer state and beta-subscription state. Availability comes from upstream notices, not a version-string comparison or a guarantee of installation eligibility. Sequential reads are not atomic; idle is not proof of completion.
- `restart_device` requests a disruptive device restart through one fixed supported ZimaOS API operation. It accepts only an empty object and requires the new independent **default-off `ALLOW_SYSTEM_CONTROL`** permission.
- `/health` reports the canonical runtime version **0.4.0** in both ready HTTP 200 and degraded HTTP 503 responses. Startup still authenticates before opening the listener; initial authentication/network failure need not produce an HTTP response.
- English and Turkish documentation now has a clearer capabilities summary, complete Tool Reference and linked detailed usage guidance.

## Restart safety

Restart interrupts all applications and connections. Each invocation sends at most one mutation request, with no redirect following, authentication replay or automatic retry after dispatch. Recognized acknowledgment returns `status: "accepted"`; an ambiguous outcome returns `status: "unknown"`. Acceptance is not reboot completion: `completion` is always `"unverified"` and `retrySafe` is always **false**. A timeout, disconnect or unknown result may follow a successful restart; do not automatically repeat the request. One-shot handling is per invocation, not global cross-client serialization.

Application permissions do not imply system control. All mutation permissions remain independently disabled by default. Credentials stay server-side; there is no SSH control plane, arbitrary shell, Docker socket or privileged server mode. Use a trusted LAN/VPN or correctly configured HTTPS reverse proxy: bearer authentication does not encrypt plain HTTP.

## Known limitations

- OS update installation remains deferred: safe eligibility, target/channel and lifecycle/failure/data/ambiguity semantics are not sufficiently verified. No installer mutation or unused installer permission is provided.
- System logs remain deferred. Generic notifications are unavailable pending authoritative evidence of a supported, meaningful notification surface; UI cards/toasts are not treated as a notification history.
- Application update (`update_app`) remains on hold pending verified supported update semantics. Network diagnostics and Files are not included.
- Positive OS update/failure states are covered by mocks, not live update transitions. Diagnostic readings do not initiate refresh, channel changes or installation.
- Existing risky installation/editing still requires a compatible modern client displaying signed, expiring, single-use exact-content approval; legacy risky requests fail closed. Approval/locks/reservations are process-local. Upstream atomic Compose compare-and-swap, general rollback and exact uninstall storage retention are not guaranteed.

Pin the released image digest for exact deployment. Promotion reuses the trusted-main candidate without rebuilding, preserving provenance and SBOM. See [installation](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.0/README.md#zimaos-installation), [changelog](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.0/CHANGELOG.md) and [release contract](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.0/docs/RELEASE.md). Git tags, GitHub Releases and GHCR readback remain authoritative for publication identity.
