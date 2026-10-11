# Tool usage and safety semantics

[Türkçe](TOOL-USAGE.tr.md) · [Public tool inventory](../README.md#tool-reference)

Detailed contracts supplement the concise README inventory; they do not grant additional permissions.

## System diagnostics

System diagnostics provides two authenticated read-only tools, each accepting only `{}`; additional arguments
are rejected. All mutation flags may remain disabled. No ZimaOS refresh/check action, subscription
change, status reset, install, restart or app update is performed. These tools are available in v0.4.0 and later.

- `get_system_resources` returns available `cpu.utilizationPercent` (0–100) and
  `cpu.logicalProcessors` (1–4096); `memory.totalBytes`, `usedBytes`, `availableBytes`,
  `freeBytes`, `usedPercent` (0–100); and `systemStorage.totalBytes`, `usedBytes`,
  `availableBytes`. Byte counters are nonnegative safe integers. Missing fields and empty groups
  are omitted, never replaced with zero. Invalid numeric evidence fails closed. Values are
  upstream samples, not an instantaneous measurement or guaranteed common-time snapshot;
  rounded percentages need not exactly match byte ratios. Available memory is not free memory;
  filesystem available space need not equal total minus used. Storage covers only the system
  filesystem, not all disks/pools. Temperature is omitted because zero can mean no sensor;
  upstream storage-health meaning is insufficient for a machine/pool-health verdict. No network,
  GPU, power, path or disk-identity data is returned.
- `get_os_update_status` returns `currentVersion`, `latestVersion`, `notice`, `updateAvailable`,
  `installerStatus` and `betaSubscription`. `notice` is `no-update`, `normal-update`,
  `important-update` or `force-update`; `updateAvailable` is false only for `no-update`.
  This is the Installer's reported classification, **not** a version comparison or guarantee
  of installation eligibility. `installerStatus` is `idle`, `installing` or `installError`;
  idle does not prove completion. `betaSubscription` is `enabled` or `disabled`, not a channel
  eligibility verdict. Five sequential reads are not atomic and can change between requests.
  Versions are bounded to 64 ASCII characters in dotted three-component form with an optional
  prerelease suffix; malformed, unrecognized or credential-bearing evidence fails closed.
  Release notes, raw messages and the UI's approximate step-based progress are not returned.
- Each diagnostic response is limited to 64 KiB with a full-body request timeout and redirects
  rejected. Upstream failures return normalized errors, not a false no-update/healthy result.

## App Store discovery

App Store discovery is available in v0.3.0 and later. Both tools require
normal MCP authentication, work with all mutation flags disabled, and perform only supported
ZimaOS reads (plus authentication when needed). They do not manage repositories or fetch
caller-supplied URLs.

- `search_app_store` accepts strictly `{ "query": "search text", "limit": 20 }`.
  `query` is required, trimmed, nonempty literal text: at most 256 UTF-16 code units before
  trimming, with control characters and DEL rejected. `limit` is optional, an integer from
  1 to 50, default 20. Empty-query browsing is not supported by the verified upstream API.
- Search returns `{ "apps": [...], "truncated": false }`. Each app has exact `repo_id`
  and `app_id`, plus available `name`, `version`, `tagline`, `category`, `architectures`.
  Search uses ZimaOS fuzzy matching with fixed English localization, reads at most five
  60-entry pages, and sorts that bounded relevance window by repository/app identity before
  applying the limit. `truncated` means the limit or window omitted results; it is not a
  catalog-wide ordering or completeness guarantee. The same app ID in different repositories
  remains distinct; repeated exact pairs, failed repositories or inconsistent pages fail closed.
- `get_app_store_details` accepts strictly `{ "repo_id": "registered-repo-id",
"app_id": "com.example.app" }` and returns the same identity/summary fields plus available
  `description`, `author`, `developer`, `release_notes`. Both tools omit absent optional fields.
  Details do not include raw Compose, configuration, source URLs, installed state, update
  availability or a compatibility verdict. Advertised architectures are not an installation
  eligibility guarantee; the existing installer independently revalidates its safety contract.
- Display strings are bounded in UTF-16 code units: name 120, version 80, tagline 512,
  category 128, description 12,000, author/developer 256 each, release notes 8,000. Architectures
  are at most eight unique sorted lower-case alphanumeric/underscore labels, each at most
  32 characters. Malformed or credential-bearing selected metadata fails closed, not silently
  truncated or partially returned. Catalog descriptions are untrusted content, not instructions.

## Native App Store installation

`install_app_from_store` accepts only two required string fields:

```json
{ "repo_id": "registered-repo-id", "app_id": "com.example.app" }
```

Use exact identifiers from the host's registered App Store repository/catalog, not display
names or URLs. Repository IDs are bounded to 128 characters; canonical lower-case
reverse-domain app IDs to 192. Additional fields are rejected. There is no caller-supplied
Compose, repository/Compose URL, architecture override, version, force, update or downgrade option.
Use `search_app_store` and `get_app_store_details` to obtain exact identities in v0.3.0,
or the normal App Store UI/catalog in earlier releases without discovery. See
[`v0.3.0 release notes`](RELEASE-NOTES-v0.3.0.md).
No repository-management MCP tool is provided.

- Supports enabled registered **v2 HTTP repositories**, **Compose-class** entries and exact
  server-selected **amd64/arm64** Compose variants. Unsupported classes, malformed detail,
  mismatched identity/architecture or noncanonical paths fail closed; no download fallback.
- Preserves verified `x-casaos.id` and adds the selected `x-casaos.repo_id` only when absent.
  The deterministic final bytes are analyzed, dry-run validated, approved when risky and submitted
  unchanged. Store origin does not bypass modern approval. `uncontrolled=false` and port checking
  are enforced internally; enabling `ALLOW_APP_INSTALL` enables both installation tools.
- Before dry-run, scans at most 128 installed apps through supported association reads. An existing
  canonical catalog ID conflicts regardless of repository or project name. Unreadable, malformed
  or ambiguous association evidence and excessive listings block installation, not trigger update.
  Association reads expose only identity metadata internally; raw credential-bearing Compose
  remains blocked by the existing public read path.
- Shares process-local serialization/name reservations with Compose installation and reserves
  native catalog IDs. Accepted or uncertain attempts remain reserved until server restart,
  including after uninstall; definitive rejection releases reservations. Verify actual host state
  before restarting after an uncertain result. Reservations are bounded and fail closed on exhaustion;
  they are neither durable nor cross-process locks and cannot prevent external-actor races.
- Sends at most one real install POST. `accepted` is asynchronous acceptance, never completion.
  One immediate list read, plus at most one container read and one health probe if the exact
  project is visible, yields `reconciliation: observed|pending|unknown` and optional `appId`,
  `containerCount` and `health`. Visibility, running containers or health are observations, not
  proof of overall completion. There is no polling, mutation retry or rollback in this tool.
