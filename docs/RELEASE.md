# Release preparation

No first release is approved or published. The canonical source repository is PUBLIC as a
manager-approved pre-release project; normal development uses PRs with Squash-only merging.
The GHCR package is also PUBLIC after retained-version exposure review/cleanup; anonymous pull
access is verified. Fresh normal-user Custom App installation UAT is the next release gate and
has not started. The final version/tag and GitHub Release remain unapproved. Do not change package
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
were preserved. `stable` / `latest` are reserved for a future explicitly approved stable release;
neither currently represents an approved stable release. The artifact policy does not delete old
versions/tags automatically; further cleanup or visibility changes require manager approval.

## Approved release promotion (prepared, not executed)

After automated gates and real-user UAT, the manager chooses/approves the version, source commit
and release notes. Public package visibility is already approved; any later visibility change
requires separate approval. Hermes/local Git creates/pushes the approved version tag only then.
The prepared `release-image` workflow validates `vMAJOR.MINOR.PATCH[-prerelease.identifiers]`
(no build metadata), checks main ancestry, and requires an already published commit artifact.
It does **not** rebuild, create a Git tag, or publish a GitHub Release.

- `v<version>` is write-once within the guarded workflow: same-digest retry is harmless;
  a different digest fails rather than silently replacing an existing version.
- Stable promotion also updates `stable` and `latest` to that digest.
- Prerelease promotion updates `prerelease` only; it never updates stable/latest.
- Workflow summaries identify source commit, artifact digest and promoted version.

Mutable release aliases follow the approved promotion, not an automatically computed greatest
SemVer. Rerunning an older release can roll those aliases back; it requires explicit manager
rollback approval. The first-install UAT candidate does not execute any version promotion.

Before approval: compare changelog/release notes with implemented features, verify licenses/secrets,
inspect provenance/SBOM, and record exact-head CI/GHCR plus the UAT result. Update the changelog and
package version before building the chosen release artifact, not after it is selected.

## First real-user UAT gate

Use the verified public anonymous-pull path with a manager-reviewed digest-pinned candidate;
no registry credentials are required or belong in the Compose template. No host SSH,
Docker CLI, privileged workaround or on-host rebuild is an acceptable substitute for fresh UI UAT.

Supply the manager one digest-pinned Compose candidate with mutation permissions off. The manager
uses ZimaOS **Custom App → Docker Compose/YAML import**, fills the four required variables,
installs, and reports first-start/health behavior without sharing passwords/tokens. Stop after
this fresh-install gate; client connection and mutation UAT are subsequent bounded gates.
