# Release process and evidence

`v0.1.0` remains the first stable release, dated 2026-10-09 in the changelog. `v0.2.0` is the
selected next stable release line; package and lockfile versions for this source are `0.2.0`.
Publication state is authoritative in Git tags, GitHub Releases
and GHCR version/alias readback, not in this source document. This is a release-process contract
and evidence record, not an assertion that a tag, Release or alias exists.

The canonical source repository is PUBLIC after manager approval; normal development uses PRs
with Squash-only merging.
The GHCR package is also PUBLIC after retained-version exposure review/cleanup; anonymous pull
access is verified. Phase 4 external runtime UAT, including fresh normal-user Custom App installation
and clean reinstall, is complete on the separately recorded runtime-tested digest below.
Public v0.2.0 notes are in [release notes](RELEASE-NOTES-v0.2.0.md); retain the
[first-release notes](RELEASE-NOTES-v0.1.0.md) as historical evidence. Do not change package
visibility, delete registry versions/tags or create a final Git tag/GitHub Release without the
corresponding explicit manager approval.

## Artifact contract

`ghcr-publish` follows successful **push** CI on canonical `main`, never PR CI. It checks out the
exact CI source commit. In normal development this is the Squash-merged main commit, not the
pre-merge branch commit; the main push event results from the PR merge and does not authorize
direct development pushes. All publication/promotion runs share one non-cancelling concurrency group.
First publication builds one `run-<workflow-id>-<attempt>` artifact with revision/source labels,
minimum BuildKit provenance and an SBOM. It creates `sha-<full-commit>` from that exact digest.
Reruns reuse that commit tag and skip building. Auth/network errors during registry inspection fail
closed; they are not evidence that the tag is absent. Conflicting immutable-tag promotion fails.

Only the current `main` head advances `edge`; delayed older builds cannot replace that alias.
Pinned base digests and cleaned install caches reduce drift, but rebuild byte equality is not a
product guarantee. Administrators can still alter/delete GHCR tags. For exact UAT/deployment pin
`ghcr.io/lvgvs/zimaos-mcp-server@sha256:<reviewed-digest>`.

The stale pre-policy `latest` tag and pre-migration/private-history tagged artifacts were removed
during owner-reviewed cleanup. Canonical artifacts and provenance/SBOM-related untagged versions
were preserved. `stable` / `latest` are managed only by explicitly approved stable-version promotion;
their live targets must be verified against the release record. The artifact policy does not delete old
versions/tags automatically; further cleanup or visibility changes require manager approval.

## Release promotion contract

After automated gates and real-user UAT, the manager chooses/approves the version, source commit
and release notes. Public package visibility is already approved; any later visibility change
requires separate approval. Hermes/local Git creates/pushes the approved version tag only then.
The tag-driven `release-image` workflow validates `vMAJOR.MINOR.PATCH[-prerelease.identifiers]`
(no build metadata), checks main ancestry, and requires an already published commit artifact.
It does **not** rebuild, create a Git tag, or publish a GitHub Release.

- `v<version>` is write-once within the guarded workflow: same-digest retry is harmless;
  a different digest fails rather than silently replacing an existing version.
- Stable promotion also updates `stable` and `latest` to that digest.
- Prerelease promotion updates `prerelease` only; it never updates stable/latest.
- Workflow summaries identify source commit, artifact digest and promoted version.

Mutable release aliases follow the approved promotion, not an automatically computed greatest
SemVer. Rerunning an older release can roll those aliases back; it requires explicit manager
rollback approval. Runtime-UAT verification is not a version-promotion operation.

Before approval: compare changelog/release notes with implemented features, verify licenses/secrets,
inspect provenance/SBOM, and record exact-head CI/GHCR plus the UAT result. Update the changelog and
package version before building the chosen release artifact, not after it is selected.

## Completed external runtime UAT checkpoint (2026-10-08)

Source: manager/user-reported external UAT results, not new agent-run runtime tests.

- **Reachable tree-equivalent runtime-tested source:** `c66254b218afd9436e5931e66518ece88ff58c5e`.
- **Runtime-tested image:**
  `ghcr.io/lvgvs/zimaos-mcp-server@sha256:78d1e7720d844f72b472d671cca2691c87069a87b78d9d7649ab6945a8d57535`.

The tested image predates the metadata-only author-email history rewrite; its OCI revision
identifies the superseded pre-rewrite source commit. The reachable commit above has the identical
source tree. External runtime UAT was not repeated because of the rewrite, and the tested digest
has not changed. Historical images/tags are not relabeled as artifacts of rewritten commits.

All reported runtime gates passed:

1. Fresh normal-user Custom App install / first start using canonical deployment YAML and
   the exact digest: `/health` 200, `{"status":"ok","service":"zimaos-mcp-server","ready":true}`.
2. Official Inspector Web from browser-local loopback negotiated MCP `2026-07-28`;
   `server/discover` and `tools/list` succeeded.
3. Read-only use passed.
4. `ALLOW_APP_CONTROL=false` denied stop; enabling only that flag allowed stop/start/restart
   of a disposable app.
5. Install/uninstall default-off gates passed; enabled benign nginx Compose install was
   accepted and observed, then uninstall was accepted and disappearance observed.
6. Compose read/validate and default-off edit denial passed; benign edit preserved health
   and readback confirmed `MCP_UAT_MARKER=phase4-benign-edit`.
7. Risky modern approval, positive MRTR continuation, and repair fully passed (details below).
8. Wrong MCP token returned 401, `WWW-Authenticate: Bearer realm="zimaos-mcp-server"`,
   and `{"error":"unauthorized"}`.
9. Wrong ZimaOS credentials failed startup before port 3900 opened; connection refused and
   `zimaos_login_failed` were observed. Repeated restart/login attempts triggered upstream
   rate limiting. Restoring correct credentials restored `/health` 200 / `ready:true`.
10. Unreachable `ZIMAOS_URL=http://127.0.0.1:9` failed startup before the listener opened,
    with `zimaos_login_failed` / `ZIMAOS_UNREACHABLE`; restoring
    `http://host.docker.internal` restored `/health` 200 / `ready:true`.
11. MCP app/container restart preserved readiness and successful modern discovery/tools list.
12. Full disposable ZimaOS VM reboot preserved readiness and modern connection/discovery/tools list.
13. Release-candidate upgrade to the exact digest above passed; later critical approval,
    failure-mode, persistence, and clean-reinstall UAT ran on that final digest.
14. MCP server uninstall followed by clean Custom App → Docker Compose/YAML reinstall passed:
    canonical structure, exact digest, no reuse of generated old `x-casaos` / `store_app_id`
    metadata; readiness, modern connection, discovery, and tools list all succeeded.
    This is the completed fresh normal-user runtime installation UAT, not a developer substitute.

### Risky approval and repair evidence

The bounded edit added only `cap_add: [CHOWN]` to `mcp-test-nginx`. Official Inspector's native
`input_required` form visibly disclosed `edit_app_compose`, target app id, base SHA-256,
exact proposed UTF-8 SHA-256, introduced `cap_add` risk delta, expiry within 300 seconds,
and an explicit boolean approval control. The user explicitly approved. MRTR continuation
returned `status=accepted`, `observation=changed`; readback confirmed `cap_add: CHOWN` and
fingerprint `812406cf5d40c9c74e1a3f9a97b2f98cde345c1aea66e9f953fc267bb1a14341`.
The app stayed healthy with nginx running.

Repair removed only `cap_add`: validation returned `accepted=true`, `requiresApproval=false`;
edit returned `status=accepted`, `observation=changed`. Final readback confirmed `cap_add`
absent, the benign marker preserved, and fingerprint
`a18be89590ff082705fba21569678e2d3399eccd770dbb2487fb5590c89059ef`.
Final app health remained healthy and nginx remained running. This targeted repair does not
establish a general rollback guarantee or cryptographic proof of human presence.

### Startup versus running readiness

`src/index.ts` authenticates before opening the HTTP listener. Invalid ZimaOS credentials or
an unreachable URL at initial startup can therefore produce connection refused, not `/health` 503. Once running, `/health` performs the supported authenticated readiness probe and can
return 503 for degraded readiness. Both behaviors are fail-closed; do not promise a startup 503.

### Preserved client boundary and release-source identity

Inspector Web requires browser-local localhost/loopback or trusted HTTPS; do not disable browser
security. The plain-HTTP LAN failure was Inspector request tracking's missing
`crypto.randomUUID()`, before discovery was sent, not a server protocol defect.
Modern `2026-07-28` clients support native `input_required` / `requestState` MRTR approval.
Legacy clients retain read-only and permitted non-risky operations; risk-increasing install/edit
fails closed, without legacy approval shims or text-confirmation bypasses.

The runtime UAT evidence is complete. Publication of the source artifact, version tag and GitHub
Release follows the explicit manager approval contract above. A docs-only checkpoint may publish a new exact-head
image under normal CI; unchanged runtime code is not a claim that external UAT was rerun on that
new digest. Keep the runtime-tested identity above distinct from the publication handoff.

The protected-main squash merge containing the final durable-documentation checkpoint is the
intended `v0.1.0` release source. Its exact SHA, trusted-main artifact digest and successful checks
are verified in the release handoff before approved tag creation. Promotion reuses that existing
artifact without rebuilding. Neither the earlier reconciliation baseline nor its image is the
final release identity. Publication requires no follow-up source-content/status commit to record
identifiers or switch pending-state prose to published-state prose; consult Git/Release/GHCR records.

## Normal-user installation procedure (verified by UAT)

Use the verified public anonymous-pull path with a manager-reviewed digest-pinned candidate;
no registry credentials are required or belong in the Compose template. No host SSH,
Docker CLI, privileged workaround or on-host rebuild is an acceptable substitute for fresh UI UAT.

Use ZimaOS **Custom App → Docker Compose/YAML import**, fill the four required variables,
review the default-off mutation permissions, and install the digest-pinned canonical Compose.
Do not reuse generated metadata from an old installation. This flow and subsequent connection /
permission / mutation / repair / persistence gates passed the manager's UAT recorded above;
do not repeat external UAT solely for this documentation checkpoint.
