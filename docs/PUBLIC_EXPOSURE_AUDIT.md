# Pre-release public-exposure audit

## Verdict and scope — 2026-10-07 UTC

**PASS for canonical source-repository exposure.** This is not approval to change visibility,
publish a stable release, expose GHCR versions, or claim fresh-install UAT passed. The manager
must separately approve the source visibility change and the disclosures listed below.

Audited candidate: `b6549cd59b4e93796ef9fd9f469a773278448ff4`, branch `main`,
https://github.com/lvgvs/zimaos-mcp-server. Repository remains PRIVATE. No child/local model,
visibility change, tag/Release creation, package deletion, history rewrite or VM operation occurred.
This document and the current STATUS correction are documentation-only audit records; their
containing commit must receive exact-head CI/GHCR verification and a refreshed exposure scan.

## Exposure inventory at the audited candidate

An independent bare clone fetched all advertised branches, tags and GitHub-managed PR head/merge
refs, including closed PR heads. Local recovery/archive refs were not confused with exposed refs.

- Five branches: `main`, `dependabot/docker/node-26-alpine`,
  `dependabot/github_actions/actions/checkout-7.0.1`,
  `dependabot/github_actions/actions/setup-node-7.0.0`,
  `dependabot/npm_and_yarn/typescript-7.0.2`.
- No tags or GitHub Releases. Eight PR head refs and four current PR merge refs.
- **64 reachable commits / 283 unique blobs**, covering every fetched ref, not only `main`.
- Eight Dependabot PRs: four open and four closed; no standalone issues. Retrieved 60
  comment/review/timeline/commit-comment records, including repeated timeline representations.
- 34 Actions runs / all 37 available run attempts' logs downloaded; no failed log retrieval.
- One retained, non-expired Docker build-record artifact, ID `11480228984`. Downloaded and
  unpacked its OCI archive; scanned decoded record content as well as original files.
- Wiki and Discussions disabled. No repository Actions secrets, variables or environments.

Counts are the candidate's audit snapshot, not promises that future automated activity is unchanged.
The follow-up scan must refresh GitHub-managed refs, PR data, runs and retained artifacts.

## Findings, including informational disclosures

1. **No exposed secret found.** Fresh checksum-verified Gitleaks 8.30.1 full-history
   `--all --full-history` scan: zero findings. Separate scans of all exported blobs, PR records,
   Actions logs and unpacked/decoded build records: zero findings. Independent privacy checks
   found no personal-provider email, actual integration password/token match, private IPv4 literal
   in repository blobs, or real credential-bearing URL. Only `.env.example` is tracked;
   `.env.integration.local` remains ignored and is not in the public corpus.
2. **Maintainer name is visible (informational).** Twelve historical commits retain the
   maintainer's full name, which matches the existing public GitHub profile. All 64 commits'
   author/committer emails are GitHub noreply identities. Remaining identities are `lvgvs`,
   Dependabot and GitHub. Earlier authorized sanitation explicitly preserved names. No name
   rewrite is required for this verdict; pseudonym-only publication would require a new manager
   history/privacy decision, not an ordinary current-file edit.
3. **Archive existence is disclosed (informational).** AGENTS/DECISIONS/STATUS and reachable
   historical revisions identify the private-history archive, preservation rationale and old
   evidence identifiers. The separate historical repository was independently read back PRIVATE
   and archived. These are intentional historical references, not current source/download links;
   canonical URLs and OCI source labels name the active repository. Making the canonical source
   public does not publish the separate archive's commits, PRs or logs.
4. **Engineering records become public (informational).** AGENTS, PROJECT, STATUS, DECISIONS,
   RESEARCH and their history disclose the AI-assisted workflow, manager gates, test-fixture names,
   ZimaOS version, generic development paths and historical defects/limitations. No private VM
   connection address or credential was found in those records. These are appropriate provenance,
   security and contribution documentation; no removal is required. Historical status snapshots
   are not current deployment instructions.
5. **Ephemeral CI addresses are retained (low).** Docker build tracing records the GitHub-hosted
   runner/build container's RFC 1918 local connection addresses. They are not repository examples
   or evidence of a homelab endpoint. BuildKit `source.local` / tracing `http.local` are operation
   or attribute names, not private DNS hosts. No credentials were found in the artifact. Retention
   is acceptable; this verdict does not claim the artifact contains no infrastructure metadata.
6. **Scanner/privacy-pattern triage (informational).** An authenticated repository-metadata API
   response generated a temporary clone token in the private audit workspace. Isolated scanning
   confirmed that this was the sole initial directory-scan hit. It was absent from repository,
   PR, log and artifact material and excluded from the actual public corpus; it was never printed
   or committed. npm registry package URLs, test-only malformed URL fixtures, secret-file basenames,
   `host.docker.internal` and fictional `example.lan` were not real credential/private-host leaks.
7. **GHCR metadata remains independently unavailable (limitation).** Package API returns 403
   requiring `read:packages`. Successful candidate publication, canonical OCI labels and the
   manager-reported canonical-only linkage are evidence, not an independent read of package
   settings/version inventory. This source-only PASS does not clear GHCR public exposure or old
   package versions. Those remain a separate manager gate.
8. **GitHub protection settings need activation/confirmation (low, operational).** Private/free
   repository branch protection/ruleset queries return 403; private vulnerability reporting is
   unavailable and fork-contributor approval policy cannot be read for this private repository.
   Actions permits all actions without enforcing SHA pinning. Default workflow token is read-only
   and Actions cannot approve PRs. Committed actions are SHA-pinned; privileged publication accepts
   only successful same-repository main-push CI, not PR CI or downloaded PR artifacts.
9. **Current STATUS remote-proof text was stale (low, corrected).** Candidate CI `37617954220`
   and GHCR `37618074495` were independently read back successful at the exact candidate SHA.
   STATUS is updated with those results rather than leaving the candidate's verification pending.

No secret rotation, history rewrite, branch/PR deletion or package cleanup is indicated by this audit.
Gitleaks and pattern checks are evidence, not a mathematical guarantee that no unknown secret exists.
GitHub-managed unreachable caches and content unavailable to the account cannot be exhaustively
enumerated; all advertised refs and accessible canonical PR/run/artifact surfaces were audited.

## Pre-release labeling

PASS: both READMEs prominently state pre-release and that the first tagged release is unpublished.
SECURITY targets the development line, CHANGELOG contains only Unreleased, and release documentation
separates source exposure from stable-release approval. There are no tags/Releases. Package/MCP
`0.1.0` is internal development metadata, not an approved release. Legacy GHCR `latest` is explicitly
not an approved stable image. Fresh Custom App UI UAT and human approval UX remain unverified.

Optional owner metadata improvement: prefix the GitHub description with "Pre-release". No missing
README warning or stable-release claim requires remediation before source exposure.

## Immediate owner settings after approved public exposure

- Enable/confirm secret scanning, push protection, private vulnerability reporting, dependency
  graph, Dependabot vulnerability alerts/security updates, and CodeQL JavaScript/TypeScript scanning.
- Protect `main` with a ruleset/branch rule requiring PRs, resolved conversations, up-to-date branches
  and these CI checks: `lint + typecheck + test + build`, `production image builds`,
  `ZimaOS Compose file is valid`. Block force pushes/deletion and constrain bypasses. Require human
  approval where an actual second reviewer exists; do not invent self-review as independent approval.
- Protect `v*` tag creation/update/deletion for the release owner. Source publication must not
  authorize creating a final tag or promote stable aliases.
- Keep default Actions permissions read-only and PR-approval permission disabled. Require approval
  for all outside contributors' workflow runs, use hosted runners for untrusted PRs, and restrict
  allowed Actions / enforce full-SHA pinning where available. Retain narrowly scoped package-write
  permission only in trusted publication workflows.
- Verify archived repository remains private/archived and GHCR visibility/access remains unchanged.
  Public source is not a supported private-image installation path or package-publication approval.

Authoritative guidance consulted:

- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

GitHub explicitly warns that Actions history/logs become visible when source becomes public;
public-repository branch protection is available on GitHub Free. Confirm actual settings in the
owner UI after the approved transition; this audit changed none of them.
