# ZimaOS MCP Server v0.4.1

v0.4.1 is a patch release refining the existing application-management reads. The public surface remains **21 tools**, with no new tool, permission, request path or write capability.

## Improvements

- `list_apps` and `get_app` resolve localized display names deterministically: valid `en_us`, then `en`, then lexical locale order. New localized labels are bounded to 256 UTF-8 bytes and 32 own map entries; existing plain-string names and identifier fallback remain unchanged.
- Optional `mainService` reports an explicit configured service name. Optional container `isMainService` flags require a matching reported declaration; unavailable, malformed or contradictory evidence is omitted. No first/sole-service main role is inferred.
- `get_app_health` preserves `app`, `probe` and `containers`, while adding `containersReadStatus`. A failed container read retains the legacy empty array and adds only a sanitized `containersReadErrorCode`, never exception text. Successful read/normalization is not a complete-inventory or healthy-app verdict.
- Newly surfaced localized/main-service strings exclude configured ZimaOS password/access-token matches, including percent-escaped UTF-8. Affected tools explicitly declare read-only, non-destructive, idempotent and open-world annotations.

## Preserved boundaries and limitations

All mutation permissions remain independent and default-off. Existing approvals, request paths, retry policies and probe semantics are unchanged. Reported main-service metadata is not proof of installation origin, actual runtime primacy, reachability or health.

Multi-service relationships and failed/empty/error container-read cases are covered by mocks; ordinary naming, reported relationships and health-read status are exercised against existing ZimaOS applications. No dangerous failure is induced for coverage.

Resource/version/origin/launch/recovery extensions remain deferred. Application updates remain on hold; network and Files tools are not included. No OAuth, multi-client grants, semantic settings or other future feature is introduced.

## Installation

Use the digest-pinned Compose asset attached to this release and replace every credential placeholder. All five mutation permissions default to false. Bearer authentication is mandatory but does not encrypt plain HTTP; use a trusted LAN/VPN or a correctly configured HTTPS reverse proxy.

Promotion reuses the verified trusted-main artifact without rebuilding, preserving provenance and SBOM. Git tags, GitHub Releases and GHCR readback identify the exact published source and image. See [installation](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.1/README.md#zimaos-installation), [changelog](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.1/CHANGELOG.md) and [release contract](https://github.com/lvgvs/zimaos-mcp-server/blob/v0.4.1/docs/RELEASE.md).
