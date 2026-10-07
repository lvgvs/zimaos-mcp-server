# Status

ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Phase 4 bearer-parser CodeQL hardening — PR review gate (2026-10-07 UTC)

- **Source / workflow:** https://github.com/lvgvs/zimaos-mcp-server, PUBLIC;
  working branch `fix/linear-bearer-auth` from synchronized main
  `710e95cbbf85a5e51c07d320d4f6cbc45c07ae61`. Main protection is now active with no bypass,
  Squash-only PR merging, zero required human approvals, resolved conversations and all three
  up-to-date CI checks. Hermes/local Git retains commit/push ownership; no direct-main push.
- **Finding / fix:** HIGH CodeQL alert #1, `js/polynomial-redos`, in bearer Authorization parsing.
  The overlapping whitespace/token regex is replaced with fixed-size scheme checking and
  linear built-in trim/includes operations, without regex or reliance on the wire-header cap.
  Existing case-insensitive scheme, separator/trimming, single-line credential syntax and both
  timing-safe comparison paths are preserved. Other auth/approval behavior is unchanged.
- **Regression evidence:** the actual HTTP auth boundary failed the new 60,000-space malformed
  credential test before the fix (about 2.38 seconds against a generous one-second ceiling),
  then passed. Boundary tests include line terminators and million-character malformed values;
  real HTTP/MCP tests cover supported syntax, and spies verify both timing-safe mismatch paths.
- **Executed local gates:** focused HTTP tests 37/37; full tests 500/500 across 28 files;
  formatting/diff checks, lint, production/test typechecks, production build, Docker build and
  Compose validation passed. Gitleaks is required before branch push. No new live VM test.
- **Manager review gate:** open the PR to `main` and verify all three required CI checks plus
  both CodeQL categories against the latest PR revision/test-merge commit. Confirm alert #1 is
  absent and no new alerts are introduced; report the PR/results without merging. The main alert
  remains open until the fix reaches main; do not dismiss or suppress it. No GHCR publication/
  visibility/tag/version change, release or child model. Fresh Custom App UAT remains pending.

## Historical Phase 4 protected-main PR contract transition (2026-10-07 UTC)

- **Source / baseline:** https://github.com/lvgvs/zimaos-mcp-server is now PUBLIC, branch `main`.
  Baseline `19197558581181e2f36c6dd4db99530e3cb67398` has verified exact-head CI `37630251531`
  and GHCR `37630399683`. Its current-tree cleanup is complete; historical records remain intact.
- **Operating contract:** AGENTS, contribution and release guidance now require short-lived
  branches, Hermes/local Git / GPT-6.1 Sol commits/pushes, PRs to `main`, all required CI checks,
  current branches when required, resolved conversations, Squash-only merging and safe post-merge
  synchronization/branch cleanup. No owner/admin bypass or single-maintainer approval count.
  ChatGPT-manager direct repository writes/commits/pushes remain prohibited. Safety, clean-room,
  README parity, product scope and manager/release gates are unchanged.
- **One-time transition authorization:** this containing commit is the manager-authorized FINAL
  direct-main push while protection is inactive. Future normal changes must use PRs even before
  protection activation. Preflight found an existing `Protect main` draft with enforcement
  `disabled` and no classic main protection; no repository setting or ruleset is changed here.
- **Local verification:** format/diff checks, lint, production/test typechecks, 474/474 tests
  across 28 files, production build, Docker build and Compose validation passed. Parent-only
  documentation review; runtime, tests, dependencies, workflows, both READMEs and PROJECT are
  unchanged. No new live VM test; this containing commit needs exact-head CI/GHCR after push.
- **Next manager action:** activate/configure main protection and Squash-only repository merging.
  Stop after exact-head CI/GHCR and clean synchronized-main verification. GHCR/package visibility,
  retained-version exposure, fresh Custom App UAT and the final release remain separate gates.

## Historical Phase 4 public pre-release source approval (2026-10-07 UTC)

The final public-exposure audit passed at `ea558c4bf5f7a8e029a4c103cc15bf9cf3923ec6`.
No repository/public-corpus secret or private infrastructure leak was found. The canonical source
repository is manager-approved for public pre-release exposure; it remains PRIVATE pending the
owner's visibility transition. GHCR visibility/retained-version exposure and the final version/tag/
GitHub Release remain separate, unapproved gates. Fresh Custom App installation UAT is still pending.

- **Current-tree cleanup:** the one-off audit report was removed without rewriting history.
  Both READMEs, PROJECT and release guidance distinguish approved source exposure from package/
  release gates. No other disposable publication artifact was identified; durable engineering
  files and historical checkpoints are retained. Runtime, tests and workflows are unchanged.
- **Previous checkpoint verification:** exact-head CI `37626797366` and GHCR `37626888867`
  succeeded at the audited commit above. This cleanup commit requires its own CI/GHCR verification.
- **Cleanup verification:** format/diff checks, lint, production/test typechecks, 474/474 tests,
  production build, Docker build and Compose validation passed. Both GitHub-rendered README DOMs
  and translation parity were reviewed; phase specifications and fresh-install UAT requirements
  are unchanged. No new live integration test was needed for this documentation-only cleanup.
- **Next action:** complete cleanup verification, then stop for the owner visibility transition.
  Keep the historical repository PRIVATE + archived and leave GHCR visibility unchanged.

## Phase 4 pre-UAT candidate — automated hardening / image-access gate (2026-10-07)

- **Source / scope:** https://github.com/lvgvs/zimaos-mcp-server, branch `main`;
  canonical source is PUBLIC as a manager-approved pre-release project.
  Previous published artifact-policy commit: `5d59a52f272825ed26c980e16db13086aa777136`;
  runtime hardening is at `b6549cd59b4e93796ef9fd9f469a773278448ff4`. Hermes/local Git owns commits/pushes
  with the repository-local noreply identity. Phase 3 feature freeze is preserved;
  Product scope and the private/archived historical repository are unchanged; current Git rules
  are in AGENTS.
- **Digest issue closed:** identical Node 22 base index/base layers, varying project config /
  filesystem timestamps, npm logs and V8 compilation caches; equal TypeScript output bytes.
  Both rebuild non-reproducibility and unsafe tag-overwrite policy existed. Node 24 Actions
  runtime was not the app-runtime cause. No byte-for-byte rebuild guarantee is claimed.
- **Artifact-policy remote proof:** exact-source CI `37608826697` succeeded. GHCR `37608925235`
  attempts 1/2 succeeded; attempt 2 skipped building and reused the first inspected digest
  `sha256:bd43342131192cac9dffca5d8cbf8ccc876c22983219294b9f418dfad97aaa05`.
  Promotion reads each target back and rejects differing digests. Version promotion is prepared,
  not executed; old-release mutable-alias rollback requires explicit manager approval.
- **Configuration / error hardening:** complete decimal PORT; normalized origin-only URL;
  shipped placeholders and whitespace tokens rejected. Static config errors, sanitized startup
  and transport logs, generic upstream errors, bounded/normalized response-body failures across
  read, dry-run and one-shot mutation paths. No mutation retry was added.
- **Readiness / Docker:** supported authenticated device-info GET, shared in-flight bounded
  probes, exceptions/explicit failures fail closed, HTTP 503 for degradation. Docker uses the
  normalized configured port and requires HTTP 200 plus `ready:true`; response parsing/errors
  are silent. Local HTTP tests execute the actual Dockerfile command, including whitespace ports.
- **Dependencies / docs:** supported ESLint 10 / Node 22.13+ development minimum, patched Vitest
  and dev MCP client/transitives. Full and production npm audits each reported zero vulnerabilities.
  License findings recorded in RESEARCH. CHANGELOG remains Unreleased; version promotion / first
  release notes prepared only. Both public READMEs updated together; GitHub-rendered DOM,
  equivalent safety notes, section structure and non-prose code examples reviewed for parity.
  Security/contribution docs reviewed; TLS/trusted-network limitation made explicit.
- **Local gates actually executed:** clean dependency install, format/check, lint, production
  and test TypeScript checks, **474/474 tests across 28 files**, production build, production
  Docker build (`zimaos-mcp-server:phase4-runtime`), Compose config and diff checks all passed.
  Checksum-verified MIT Gitleaks 8.30.1 found zero leaks in staged changes and canonical-main
  history; ignored integration credentials were not part of either scan. Parent self-review only.
  New startup, secret-reflection, readiness and container-command regressions are mocked/local;
  CI remains VM-independent.
- **Live evidence:** authorized VM via compiled authenticated MCP: 15 tools discovered, two
  read tools succeeded, unauthenticated request rejected, default-off control denied; health
  200 → 503 → 200 under local transport injection. App-list baseline unchanged, zero mutations.
  Non-root production container on nondefault whitespace-normalized port 3123: actual Docker
  healthy → unhealthy → healthy after disconnect/reconnect of only the local container's bridge
  network. No VM OS/network change or app mutation. Temporary test containers removed.
- **Remote candidate verification:** runtime candidate `b6549cd59b4e93796ef9fd9f469a773278448ff4`
  exact-head CI `37617954220` and GHCR `37618074495` read back successful. Publication log and
  retained build record identify `sha256:e5109107428e522b7097ff6835f32c424371962a5a2d682334807e1b3ec94364`.
  Source/revision labels, provenance/SBOM and digest reference are available from the workflow;
  package-settings API access remains unavailable, as distinguished below.
- **Stop / manual gate:** anonymous GHCR pull-token request still returns 401; authenticated
  local manifest access returns 403 without `read:packages`. Package settings/version inventory
  cannot be independently enumerated. Manager reports private package and canonical-only WRITE
  linkage. No visibility change, deletion, final tag or GitHub Release; no Qwen/local/child model.
  Fresh real-user ZimaOS Custom App install has **not** happened; developer live/container checks
  do not substitute for it. Compose is validated, not yet normal-user UI-install-verified.
- **Exact next manager action:** approve an image-access path (public GHCR with retained-version
  exposure reviewed, or an intended supported UI private-registry
  flow for verification). Then use the exact candidate digest for FIRST REAL-USER UAT — fresh
  Custom App install + first start + health + authenticated read-only MCP + default-off denial.
  Do not use host-shell/PAT-in-YAML rescue or publish a final release. General Phase 3 limitations
  below, human approval UX and fresh deployment networking remain UAT/release gates.

## Historical Phase 4 artifact policy checkpoint (2026-10-07)

- **Active source:** canonical private repository, `main`; previous verified checkpoint
  `0f61a83186882cf0cf7da1d317311879f312305e`. Historical repository is private/archived,
  fetch-only locally, never synchronized. Manager reports canonical GHCR source linkage and
  canonical-only Actions WRITE access; post-relink rerun 36937958392 attempt 2 succeeded.
- **Image investigation:** both observed builds used the identical Node 22 base index.
  Matching base layers / differing project layers were verified from both attempt logs.
  Controlled same-source, fixed-base uncached builds reproduced config/filesystem timestamps,
  npm logs and V8 compile-cache variation; TypeScript output bytes matched. This is both
  rebuild non-reproducibility and unsafe overwrite policy, not a Node 24 application change.
- **Implemented artifact policy:** CI-success-only trusted main publication; SHA-pinned
  maintained Docker actions, pinned Node 22 base, runtime install-cache cleanup, revision/source
  labels, minimum provenance/SBOM, first-artifact commit sealing and digest-based promotion.
  Reruns reuse the existing commit artifact. Conflicts/auth/network failures fail closed;
  `edge` is development; stable/latest and prerelease promotion are separate, prepared only.
  Version workflow creates no Git tag/Release. Exact deployment/UAT uses image digests.
- **Executed gates:** 436 tests / 26 files passed; format, lint, both TypeScript checks,
  production build, Docker build, Compose config and diff checks passed. Policy tests use
  a fake Docker registry CLI; no real version tag or release alias was created for testing.
- **Next:** verify this checkpoint's CI/GHCR and same-head rerun stability, then continue
  configuration, readiness, secret-reflection and supported ESLint hardening. Fresh UI UAT
  and anonymous image-access/visibility decisions remain manager gates. No visibility change,
  old-version deletion, final release/tag, local model or child model used.

## Historical canonical migration — GHCR verified; manager review (2026-10-01 UTC)

- **Canonical source:** https://github.com/lvgvs/zimaos-mcp-server is a new PRIVATE
  repository, GitHub numeric ID `1400704911`, default branch `main`. Normal push imported
  the preserved sanitized candidate `a736778a4ba5527b5620bb0facbf4c2cf935e6e5` with 48 commits
  (47 original project commits plus the privacy checkpoint). The verified migration implementation is
  `a709194e536286a992953c27f55e59bb01ed67dd`, with 49 commits after the migration documentation
  and OCI source-label commit. The containing status-only checkpoint adds one commit;
  its own exact-head CI/GHCR must be verified after push. The earlier successful publication
  rerun required no new commit.
  Local `main` tracks the new `origin/main`; future development goes only here.
- **Private historical preservation:** https://github.com/lvgvs/zimaos-mcp-server-private-history
  retained original GitHub ID `1388638620`, original refs/history, PRs and Actions. It remains
  PRIVATE, not deleted or rewritten, with original main unchanged. GitHub archival was
  completed and read back after exact-head canonical CI/GHCR success; its branch/tag
  inventory remained identical. No old workflow was queued/running at freeze.
  Local `archive` is fetch-only with
  a disabled push URL; `remote.pushDefault=origin`. No dual-write, mirroring or synchronization.
- **Ref classification:** only `main` migrated. All eight inspected unique old branches were
  generated Dependabot updates, not manager/development work; they remain in the private
  historical repository. Recovery/candidate refs remain local-only. No old PR ref migrated;
  any subsequent automated Dependabot activity in the new repository is newly generated.
- **Privacy verification:** an independent bare clone of the new canonical repository
  matched the imported main tree/history; Gitleaks v8.30.1 full-history scan was clean.
  Main's 48-commit local preflight independently inspected 228 reachable blobs: no personal
  Hotmail metadata, RFC 1918 literals or real secret was found. No credential rotation
  indicated. Rewritten commit-reference consistency and approved external SHA pins remain
  intact; pre-rewrite registry tags are explicitly historical artifact identifiers.
- **Ownership/docs/image:** AGENTS now records Hermes/local-Git commit/push/history ownership
  and one canonical source, with no Git ownership for Qwen or external assistant-side writes.
  The manager-approved migration decision and registry findings are durable. PROJECT and
  both public READMEs remain unchanged; bilingual parity/links/disclosures were reviewed.
  Production Docker label `org.opencontainers.image.source` names the canonical repository;
  a built-image inspection verified the exact URL. Package name is unchanged.
- **Executed local migration gates:** 429/429 mocked tests in 25 files passed; dependency
  install, format, lint, both TypeScript checks, production build, Docker build
  (`zimaos-mcp-server:canonical-migration`), Compose config and diff checks passed.
  No live ZimaOS test or mutation was performed; no general Phase 4 hardening was started.
- **New-repository workflow evidence at imported head:** CI `36924353462` succeeded,
  including README parity and all configured quality/Docker/Compose gates. GHCR publish
  `36924353519` failed at tag push with `permission_denied: write_package`; login and image
  build succeeded. These are new-repository runs, not inherited old-repository evidence.
  At migration implementation head `a709194e536286a992953c27f55e59bb01ed67dd`, CI `36924944519`
  succeeded. After the owner granted the new repository Actions WRITE access, GHCR run
  `36924944585`, attempt 2, was rerun without a commit and succeeded, including tag push.
  `ghcr.io/lvgvs/zimaos-mcp-server:latest` and
  `ghcr.io/lvgvs/zimaos-mcp-server:sha-a709194e536286a992953c27f55e59bb01ed67dd`
  both published digest `sha256:ffc58b6cdfc1fcae2963edd533a178665e1aee75cba994427972adecead123e2`.
- **Package metadata limitation:** package metadata still returns HTTP 403 (`read:packages` absent).
  Current linked repository, package visibility and stale pre-rewrite version inventory are
  unverified. Hermes changed no package visibility/access setting or version; no old images were deleted.
  The canonical repository's working Actions WRITE path is verified by its own successful
  publication. Its image has the canonical OCI source label; that is not proof of the
  package settings' connected-repository field. The manager reports removing the old
  private-history repository's Actions access while retaining canonical WRITE access;
  this owner UI cleanup is manager-reported, not independently verified through the API.
  Access removal must not be conflated with unlinking the package, changing
  inheritance/visibility or deleting versions.
- **Next action:** verify this checkpoint's exact-head CI/GHCR, then stop for manager review.
  Owner may inspect/report the connected repository, visibility and retained old SHA tags.
  No general Phase 4 work,
  final release tag/GitHub Release/public visibility change, force push, Qwen or subagent.

## Historical pre-public sanitization checkpoint — superseded by migration (2026-10-01)

The snapshot below records the earlier stop. Its in-place force-push proposal is withdrawn;
the historical repository must not receive rewritten refs or future normal development.

- **Scope/state:** parent-only, manager-authorized privacy rewrite; no feature hardening.
  Original remote `main`: `835be86704b7a981054ea11c90483ec54a3d8a9c`
  (**pre-rewrite recovery identifier**, not a rewritten reachable commit).
  Local rewritten equivalent: `3767df680bce54b4d7799b0d7dfcd602034299ae`;
  the containing normal checkpoint commit is the local candidate on `main`.
  Local-only backup `refs/backup/pre-public-history-rewrite` and per-branch backups
  preserve recovery; the complete filter-repo commit map is retained locally.
- **Sanitization verified locally:** git-filter-repo v2.47.0 processed all 55 commits
  across `main` and eight inspected Dependabot branches; 54 commit IDs changed.
  No commits disappeared; parents/topology, names, dates and messages were preserved.
  The personal commit email was replaced exactly with the GitHub noreply identity;
  no Hotmail author/committer metadata remains in the rewritten candidate histories.
  Three path-scoped project examples now use RFC 5737 addresses; no RFC 1918 literal
  remains in rewritten branch content history. Current product-tree change is only
  a configuration comment, plus this checkpoint/SHA-reference documentation.
- **Secret/privacy scans:** Gitleaks v8.30.1 found no leaks before or after rewriting.
  The original-history scan was expanded to GitHub PR refs: 64 reachable commits
  (56 non-merge commits reported by Gitleaks), 243 unique blobs independently inspected.
  Additional token/key/bearer/credential/env/email/topology pattern checks found only
  code references, placeholders and mock fixtures; no real secret or local integration
  secret-value match was found. No credential rotation is indicated by these results.
  `.env.integration.local` remains ignored and untracked; scanner reports stay local.
- **SHA/documentation reconciliation:** current `main` Markdown commit references use
  the reliable old-to-new map; existing registry tags are explicitly pre-rewrite
  artifacts, and historical workflow evidence is not claimed for rewritten SHAs.
  External upstream SHA pins remain untouched. Both READMEs are unchanged, parent-reviewed
  for semantic parity, language links and the approved AI-development disclosures.
  AGENTS/PROJECT constraints remain intact. Dependabot tip-document reconciliation is
  pending the remote-ref decision; no remote candidate is claimed ready to push.
- **Local gates:** 429/429 mocked tests across 25 files passed; format check, lint,
  production/test TypeScript checks, production build, Docker build
  (`zimaos-mcp-server:history-sanitized`), deployment Compose config and diff check passed.
  Initial dependency installation inherited `NODE_ENV=production` and omitted developer
  tools; installing developer dependencies resolved that environment-only failure.
  No live VM test or mutation was performed for this history operation.
- **Blocking remote retention:** GitHub-managed `refs/pull/*` are read-only. Closed,
  unmerged PR #3 retains `refs/pull/3/head`, independently fetched and verified to reach
  seven commits with the personal email. Rewriting the nine writable branch refs alone
  cannot satisfy the full privacy-safe public-history requirement. Do not assume an open
  PR refresh purges closed PR refs or cached commit views. GitHub documents Support-assisted
  cleanup, but warns it will not remove non-sensitive data; success is not assured.
- **Remote/package status:** source repository freshly verified PRIVATE. No force push
  was performed; remote `main` remains at the original pre-rewrite head. Rewritten-head
  CI/GHCR runs do not exist yet. GHCR visibility/version inventory queries return HTTP 403
  because the available token lacks `read:packages`; stale published pre-rewrite tags
  may remain and have not been deleted. Visibility is unverified, not inferred.
  No release tag, GitHub Release, source/GHCR visibility change, local model or subagent.
- **Superseded next action:** the manager rejected the proposed in-place force-with-lease
  replacement and approved migration to a distinct canonical repository. Preserve the
  local candidate/backups and original private historical repository; never push rewritten
  history or synchronize future development to the archive.

## History-reference interpretation

Repository commit references below identify the rewritten equivalents after the approved
pre-public privacy sanitization. Historical CI/GHCR run IDs still describe executions
on the original, pre-rewrite commits, not verification of the rewritten equivalents.
Existing `sha-` container tags are intentionally retained as **pre-rewrite artifact
identifiers**; Git rewriting does not rename or delete registry images. Historical
snapshot SHA references in earlier file revisions are likewise pre-rewrite identifiers;
this current document reconciles the reachable repository commit references.

## Current phase / milestone

- **Phase 3:** complete and manager-approved. Final Phase 3 HEAD:
  `febdcf5c061edb9f21f80dc5115f30e51149de0b`.
- **Phase 3 milestones:** 3A `3102cdcd5533293c921c99c8f61e313daeed17b1`; 3B
  `14b8f44180d1e4fb37fafca79c5d86e73fec25f4`; 3C
  `60879a80d83659493e8256a765862c6e33cd5a4e`; 3D
  `8467546bd137d9bdb6703f3d4dde3c181264be58`; closing fix
  `febdcf5c061edb9f21f80dc5115f30e51149de0b`.
- **Phase 3 final verification:** **429/429** mocked tests passed. Lint, formatting, production and
  test TypeScript checks, production build, Docker build, ZimaOS deployment Compose validation,
  and `git diff --check` passed. Final-head GitHub CI run `36894143739` and GHCR publish run
  `36894143683` both completed successfully.
- **Phase 3 live acceptance:** a fresh benign existing-app edit returned normalized `accepted`
  after the narrow verified async-response correction, and read-after-write confirmed the requested
  value. Default-off denial, non-mutating dry run, stale-base rejection, and risky first-round
  non-mutation passed. Privileged risky continuation remained mocked rather than live-mutated.
  Dedicated fixtures were removed; the final disposable-VM list contained only pre-existing
  `mcp-test-nginx`, whose health probe was healthy.
- **Phase 3 API/recovery boundary:** runtime remained inside supported official ZimaOS APIs.
  No supported explicit rollback API or reliable general rollback guarantee was verified, so the
  product provides bounded read-only reconciliation rather than automatic rollback. External-writer
  race remains because upstream exposes no atomic compare-and-swap. `update_app` remains absent
  because App Store update/version-transition semantics are still unverified.
- **Phase 4:** **Release Hardening + First Release is now explicitly manager-authorized** in
  `PROJECT.md`. Phase 3 is the feature cutoff. Phase 4 should harden deployment/config/auth/docs/
  release engineering, run bounded real-user UAT gates with the manager, fix concrete release
  defects, and prepare the first tagged release.
- **Phase 4 manager gates:** real-user UAT results must come from the manager/user; final release
  publication, final version/tag, source-repository visibility, and GHCR visibility changes require
  explicit manager approval. Do not begin a later phase automatically.
- **Current next action:** manager review of the bearer-parser PR after required CI/CodeQL proof;
  no merge is authorized for this hardening handoff.
  The separate image-access/UAT manager gate remains pending; no UAT result was reported.

## Phase 4 initial audit — image-access manager gate (2026-10-01)

- **Reconciliation:** clean `main` at Phase 3 implementation HEAD was safely fast-forwarded
  through the single manager transition commit to `5e31b3dfe47bc2f6c7a1bcc4d446379b1d3d710c`;
  `origin/main` matched. Durable Phase 4 authorization and Phase 3 closing evidence were read.
  No history rewrite, local model, child, or new live VM mutation/test was used.
- **Checkpoint candidate:** the containing checkpoint commit on `main`; runtime remains exactly
  the manager transition baseline above. Only README, deployment comments, research, and this
  status were changed. This is an audit checkpoint, **not a UAT-ready release candidate**.
  Parent self-review owns the diff; no delegated reviewer was used.
- **Automated checkpoint verification:** 429/429 mocked tests across 25 files passed; lint,
  formatting, production/test TypeScript checks, production build, Docker build
  (`zimaos-mcp-server:phase4-audit`), ZimaOS Compose config validation and `git diff --check`
  passed. Config/auth/modern/legacy HTTP regressions ran as part of the full suite.
  Production `npm audit --omit=dev` reported zero vulnerabilities. Lockfile runtime licenses
  are Apache-2.0 (project), MIT and ISC (dependencies); no dependency changes were made.
  `.env.integration.local` remains ignored, untracked and unstaged; only `.env.example` is
  tracked among environment files. No runtime shell/SSH/socket/privileged control path was added.
- **Remote baseline verification:** CI `36903520647` and GHCR publish `36903520625` succeeded
  for the rewritten equivalent `5e31b3dfe47bc2f6c7a1bcc4d446379b1d3d710c`; Phase 3 closing
  runs also read back as successful on their original pre-rewrite commits.
  Audit checkpoint `99ee2fcf2b5c8df22b7ac945fd8ae46f4e7bea2b` was committed/pushed with clean
  `main` matching origin; CI `36906056806` and GHCR publish `36906057235` both succeeded.
  Its image is `ghcr.io/lvgvs/zimaos-mcp-server:sha-7d3e36b0247795575b317ebe2b961e4565667285`.
  This containing documentation-only follow-up records those results; verify its own exact-SHA
  workflows after push rather than inferring them from the earlier runs.
- **Image-access blocker:** source repository freshly verified `PRIVATE`. Current GHCR package
  visibility cannot be queried: token lacks `read:packages` (HTTP 403). Anonymous pull-scoped
  GHCR token request returned HTTP 401. No supported normal-user ZimaOS UI registry-auth flow
  has been verified. Published images alone do not unblock installation. README's developer
  host-build rescue path was removed; deployment comments no longer recommend it.
- **Manager decision:** approve public GHCR package access while retaining private source,
  acknowledging exposure of existing package versions, or identify an intended supported UI
  registry-auth flow for verification. No package/repository visibility was changed. Do not
  begin installation UAT, ask for shell rescue, or add a permanent PAT requirement meanwhile.
- **Audit findings queued for bounded hardening after this gate:** `PORT` currently uses
  `parseInt` and accepts numeric prefixes; malformed URL errors reflect the configured value;
  URL userinfo/query/fragment are not rejected; shipped credential/token placeholders are not
  rejected (the example token exceeds the minimum, contrary to deployment comments); the Docker
  healthcheck fixes port 3000 and checks only HTTP success, not `ready`; raw error-message log
  paths and generic upstream detail extraction need secret-reflection regression coverage.
  These are not fixed by this docs-only checkpoint and prevent a UAT-ready claim.
- **Release engineering/docs remaining:** package and MCP metadata remain `0.1.0`, not an
  approved first-release version; no tags, GitHub Releases, changelog or release workflow exist.
  Current publish workflow publishes `latest` for main and all `v*` tags independently of CI;
  SHA tags are a naming convention, not enforced registry immutability. Review publication gates
  and prerelease/latest behavior before any tag. Quick Start, troubleshooting, permission/approval
  coverage, upgrade and uninstall/reinstall instructions remain release-preparation work.
- **Current UAT gate/result:** fresh ZimaOS Custom App install + first start; **not started**,
  blocked on image access and queued automated hardening. Phase 3 VM baseline restoration is
  durable historical evidence (only `mcp-test-nginx`); it was not re-probed in this pass.
- **Known limits preserved:** `update_app` absent; no supported explicit rollback/general recovery
  guarantee; async acceptance is not completion; external-writer race remains; risky legacy
  clients fail closed; human disclosure UX remains untested; approvals/locks are single-process;
  uninstall storage-retention semantics remain unverified. No final release tag or GitHub Release.
- **Exact resume action:** read current disk state, check usage and Git/remote relationship,
  obtain manager image-access decision, then TDD-fix the concrete queued release defects,
  finish release docs/config audit, run all exact-candidate pre-UAT gates, commit/push and verify
  exact-SHA CI/GHCR. Only then supply one SHA-pinned fresh-install UI UAT and wait for its result.

## Git / repository

- **Branch:** `fix/linear-bearer-auth` (unmerged PR work targeting `main`).
- **Phase 2 final implementation HEAD:** `7dcb169d29df8b154c4658a689f5b9120db2e4f0`
- **Phase 3A HEAD:** `3102cdcd5533293c921c99c8f61e313daeed17b1`
- **Phase 3B HEAD:** `14b8f44180d1e4fb37fafca79c5d86e73fec25f4`
- **Phase 3C HEAD:** `60879a80d83659493e8256a765862c6e33cd5a4e`
- **Phase 3D HEAD:** `8467546bd137d9bdb6703f3d4dde3c181264be58`
- **Phase 3 final implementation HEAD:** `febdcf5c061edb9f21f80dc5115f30e51149de0b`
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server
- **Repository visibility at Phase 4 authorization:** private.
- **GHCR:** `ghcr.io/lvgvs/zimaos-mcp-server:sha-a20a35efd9dea08fbfc3c69f0661b03217934ff6`;
  final Phase 3 publish workflow succeeded. Package visibility could not be independently queried
  with the available token because it lacks `read:packages`; visibility changes remain a separate
  explicit manager decision.

## Pause checkpoint — Phase 2B (2026-09-28)

This section is a historical pause snapshot, superseded by the current milestone above and
the resumed implementation record below.

- **HEAD / branch / remote:** `d2c7b49b015c3c5b9e350b223a86649cd164ac53`,
  `main`, remote `main` matched. Phase 2A (`d2c7b49`) was committed and pushed
  before the pause; no commit or push was made during the pause procedure.
- **Completed bounded work since Phase 2A:** Added exact `yaml@2.9.1` production
  dependency and a bounded parser (`src/compose/parse.ts`), preserving the original
  string and rejecting malformed/warning/ambiguous or over-budget YAML. Added a
  structured Compose risk analyzer (`src/compose/analyze.ts`) for privileged mode,
  host namespaces, runtime socket/host binds, devices, added capabilities,
  security options, named-volume indirection, and unsupported external includes/
  builds/extends. Parser and analyzer have focused tests. Neither is wired to an
  MCP tool yet; this is not a complete safety proof for arbitrary Compose.
- **Last Qwen task:** Add non-mutating `ZimaOsClient.validateCompose` using the
  supported dry-run/port-check query, exact YAML body, and normalized 200/400/502
  outcomes, with mocked tests. The child was steered for pause and specifically
  stopped at an edit boundary; its final result was **interrupted**. It changed
  `src/zimaos/client.ts` and `tests/client.test.ts`. Seven dry-run tests exist,
  but security review remains unfinished: a 401/403 response is currently
  classified as a validation rejection instead of an authentication/authorization
  failure, an upstream `message` is surfaced without proving it cannot echo
  submitted Compose content, and a 2xx envelope with `success:false` is not
  distinguished from acceptance. Do not expose the method through MCP before fixing.
- **Intentionally dirty worktree:** modified `package.json`, `package-lock.json`,
  `src/zimaos/client.ts`, `tests/client.test.ts`; untracked
  `src/compose/parse.ts`, `src/compose/analyze.ts`,
  `tests/composeParse.test.ts`, `tests/composeAnalyze.test.ts`, plus this status
  update. No tracked files were reset or recreated; the local secret env remains ignored.
- **Verification at pause:** focused client/parser/analyzer tests **133/133 passed**;
  production and test TypeScript checks passed; `git diff --check` passed.
  Earlier, before the interrupted dry-run edits, the parent independently ran
  the full mocked suite at **122/122**; the analyzer child separately reported
  **160/160** after its extension. Formatting currently **fails**
  on `src/zimaos/client.ts` and `tests/client.test.ts`. The full suite, lint,
  build, Docker build, and Compose validation were **not rerun** on the current
  dirty tree. No Phase 2 live VM acceptance was performed.
- **Remaining after resume:** finish Phase 2B safe validation tool/API tests and
  full gates; Phase 2C install permission, duplicate protection and single POST;
  Phase 2D modern single-use risky approval; Phase 2E uninstall; live benign
  acceptance, cleanup, docs and gates. `update_app` remains intentionally
  unimplemented pending verified App Store update semantics. No child remains active.

## Phase 2B resumed implementation (local, mocked)

- `yaml@2.9.1` parser applies UTF-8 byte, depth, node, alias and traversal budgets,
  rejects warnings, duplicate merge keys and cycles, and preserves the exact source.
  Risk analyzer reports fixed-category host-control findings; validation fails closed if
  more than 256 findings would be returned. Local analysis is not Docker Compose validation.
- `ZimaOsClient.validateCompose` posts the exact source as YAML with explicit dry-run and
  port-conflict checks. HTTP 401 reauthenticates once, 403 remains a permission failure;
  upstream free-form messages are never relayed. HTTP 2xx `success:false` is not accepted;
  empty 502 remains ambiguous, not proof of invalidity or outage. No real install POST.
- `AppService.validateCompose` and `validate_app_compose` MCP tool perform local analysis
  then upstream dry-run without requiring top-level `name:` or app-control permission.
  Invalid local documents stop before contacting ZimaOS. Phase 1 tools remain registered.
- Independently executed on this worktree: `npm test` **191/191** across 8 files,
  `npm run lint`, `npm run format:check`, production and test TypeScript checks,
  `npm run build`, `docker build -t zimaos-mcp-server:phase2b .`,
  `docker compose -f deploy/zimaos/docker-compose.yml config --quiet`, and
  `git diff --check` — all passed. These are mocked/local gates, not live VM acceptance.
  `.env.integration.local` remains Git-ignored. No Phase 2 live VM action yet.
- Branch `main`; base commit before Phase 2B is `d2c7b49b015c3c5b9e350b223a86649cd164ac53`;
  repository https://github.com/lvgvs/zimaos-mcp-server (private). GHCR Phase 2 image not
  verified; ZimaOS Compose deployment not yet exercised for Phase 2.

## Phase 2C implementation checkpoint (uncommitted, mocked)

- Dedicated `ALLOW_APP_INSTALL` permission defaults off independently of Phase 1 control.
  `ZimaOsClient.installComposeOnce` sends one exact-source YAML POST with explicit
  `dry_run=false` and port checking, never retries after a mutation attempt, and reports
  asynchronous acceptance separately from completion. HTTP 429 remains rate limiting.
- Local install identity requires explicit safe top-level name and rejects collisions
  against app id/display name. Preflight lists installed apps and performs one upstream
  dry run, failing closed on invalid/ambiguous response and port conflicts. Risky input
  returns confirmation-required without mutation. Safe-install service serializes
  preflight and one real POST with an in-process queue. This does not eliminate races
  against actors outside this server or guarantee immediate app-list visibility after
  asynchronous acceptance.
- Independently ran `npm test`: **250/250** across 12 files; production and test
  TypeScript checks, lint, format check and `git diff --check` passed after correcting
  a test type error and unused import. These are mocked/local results; no Phase 2C
  Docker build or live VM test yet. The previous concurrency child timed out after
  leaving valid partial code/tests; the parent retained, fixed and verified them.
- **Not implemented/exposed:** `install_app_from_compose` MCP tool, risk challenge /
  post-disclosure approval, uninstall, update. No Phase 2C commit/push yet. The
  higher-level manager approved the existing modern MCP input-required design,
  content-bound signed state, expiring bounded single-use ledger, rechecks and
  consume-before-one-POST rule, modern-only risky path, and explicit human-presence
  limitation. A new scope/safety issue, not this existing design, would be a blocker.

## Pause checkpoint — Phase 2C (2026-09-29)

This is a historical pause snapshot, superseded by the resumed Phase 2C milestone below.

- `main` HEAD `74c7d6cf7b797a2552e5109c9fbe582da00bf35b` (pushed Phase 2B);
  Phase 2A was committed/pushed at `d2c7b49b015c3c5b9e350b223a86649cd164ac53`.
  Worktree intentionally dirty: modified `STATUS.md`, `src/config.ts`, `src/errors.ts`,
  `src/index.ts`, `src/permissions.ts`, `src/zimaos/appService.ts`, `src/zimaos/client.ts`,
  `tests/client.test.ts`, `tests/config.test.ts`, `tests/permissions.test.ts`; untracked
  `src/zimaos/installIdentity.ts`, `src/zimaos/installPreflight.ts`,
  `tests/installIdentity.test.ts`, `tests/installPreflight.test.ts`,
  `tests/installSafe.test.ts`, and `tests/installConcurrency.test.ts`.
- Last Qwen task `sa-0-32740bb6`: process-wide install-name reservation to prevent
  a second same-name POST while the asynchronous ZimaOS app list is stale. It was
  steered to stop at the atomic test-file write and completed in response to pause;
  **only** `tests/installConcurrency.test.ts` changed in this task. No reservation
  implementation was written. Tests encode accepted/timeout stale-list behavior;
  they remain TDD-red, not a passing feature. No child remains active.
- Parent reviewed the full test file and service. `installSafeCompose` currently has
  a process-wide serialization queue but **no name reservation**; its comment claiming
  a second request will see the new app in the list is not guaranteed. The queue
  permits a duplicate POST if a subsequent list read is stale. Do not expose the
  install tool or claim duplicate protection complete until corrected. No global
  unsafe bypass or mutation retry was introduced in the last child edit.
- Focused `npx vitest run tests/installConcurrency.test.ts` on the present worktree:
  **2 passed, 2 failed**, exactly the accepted-stale-list and timeout-stale-list
  reservation expectations. `npx tsc -p tsconfig.test.json --noEmit` passed;
  `npx prettier --check tests/installConcurrency.test.ts` failed (formatting).
  `git diff --check` passed. Before the last test edit, parent independently ran
  full mocked `npm test` **250/250**, lint, format, production/test typechecks;
  those full gates were **not rerun on the present worktree**. Phase 2C build,
  Docker build, Compose config and live VM acceptance have not been run.
- **First bounded resume action:** implement a fail-closed, process-wide reservation
  for the exact normalized install name after ready preflight and before the one
  real POST; keep accepted/uncertain attempts reserved through list lag, release
  only on definitive rejection or known pre-POST failure. Run the new focused tests,
  both TypeScript checks and format the test; independently review diff/semantics.
  Do not silently infer an arbitrary reservation expiry or retry uncertain installs.
- Remaining Phase 2C: finish reservation, wire/install-test the MCP tool without
  bypassing the risky post-disclosure flow, update deployment/docs/config, run full
  gates, and commit/push only a coherent milestone. Then Phase 2D approved single-use
  risky approval, Phase 2E independently gated uninstall, Phase 2 live acceptance
  and disposable-VM cleanup. `update_app` remains unimplemented pending verified
  App Store semantics. No new child, commit, push, or live operation occurred for
  this pause. Preserve all dirty work; wait for explicit resume.

## Phase 2C resumed milestone (local, mocked)

- `ALLOW_APP_INSTALL` defaults off independently of reversible app control. Safe install
  requires an explicit conservative top-level name, checks host id/display-name collisions,
  performs a fresh list read and upstream dry run with port-conflict checking, and preserves
  the exact original YAML for at most one real POST. Risky findings return
  `confirmation_required` without mutation; no Phase 2D approval is present yet.
- A serialized process-wide queue and bounded fail-closed name reservations prevent a
  second same-name POST even if the upstream list lags after asynchronous acceptance or an
  ambiguous timeout. A definitive rejection releases its reservation. Reservations are
  process-local and retained for uncertain outcomes; this does not prevent external writers,
  nor does it establish completion. No automatic mutation retry or global unsafe bypass.
- `install_app_from_compose` is registered over authenticated MCP; `.env.example`, README,
  and ZimaOS deployment Compose document the default-off permission and safe path.
- Independently executed: mocked `npm test` **258/258 across 12 files**; lint, format check,
  production/test TypeScript checks, production build, Docker build
  (`zimaos-mcp-server:phase2c`), deployment Compose config validation and `git diff --check`
  all passed. No Phase 2C live VM test or GHCR publication verified yet.
- Branch `main`, base HEAD `74c7d6cf7b797a2552e5109c9fbe582da00bf35b` before
  Phase 2C commit. Repo https://github.com/lvgvs/zimaos-mcp-server (private).
  Phase 2D risky approval, Phase 2E uninstall and final live acceptance remain.

## Phase 2D implementation (local, mocked; committed)

- Modern MCP 2026-07-28 risky installs return native `input_required` form elicitation
  after a non-mutating preflight. The message discloses fixed risk categories/fields,
  exact source SHA-256 and expiry. Legacy risky installs fail closed; benign legacy
  installs remain available under the default-off install permission.
- Exact UTF-8 source, intended name, target digest, fixed install options and risk
  policy/disclosure digest are bound into HMAC-signed, 300-second request state. An
  independently bounded process-wide pending/consumed challenge ledger enforces
  single use. The signing key is ephemeral; restart invalidates pending approval.
  The deployment's authenticated bearer principal is bound without exposing its token.
- A second modern request requires signed state and accepted `confirm: true` form
  content. Under the same install lock it rechecks permission, host identity,
  parsed risks, upstream dry run and port conflicts, then consumes approval before
  one exact-source POST. It preserves the name reservation on accepted/uncertain
  outcomes and does not retry mutation. An accepted result receives one bounded
  read-only list observation (`observed`/`pending`); neither proves completion.
- Independently ran mocked `npm test` **360/360 across 17 files**, lint, format,
  production/test TypeScript checks, build, Docker build (`zimaos-mcp-server:phase2d`),
  deployment Compose validation, and `git diff --check` — all passed.
  No live Phase 2 VM action has occurred. Client-side human presentation is a
  requirement of the chosen client, not a cryptographic property of MCP;
  automated tests verify wire behavior, not actual human presence.
- Phase 2D committed/pushed at `26a488c5150e42a7535ceaa32b280e68c7c3665e`.
  Next: Phase 2E uninstall, then final live benign acceptance and VM
  cleanup. App Store update semantics remain unverified; `update_app` is absent.

## Phase 2E implementation (local, mocked)

- Independent default-off `ALLOW_APP_UNINSTALL` does not imply install or app control.
  `uninstall_app` validates an explicit conservative id and confirms exact presence in
  a fresh host list before the single supported DELETE with
  `delete_config_folder=false`. No arbitrary path, volume, or host cleanup is exposed.
- Shared process-wide serialization and bounded same-id reservations prevent another
  DELETE while an accepted or ambiguous attempt is unresolved, even with a stale list.
  A definitive rejection releases a reservation. An accepted response is asynchronous,
  with one bounded read-only list observation (`pending`/`absent`), not completion proof.
  No automatic mutation retries. Storage retention effects remain unverified.
- Independently ran mocked `npm test` **388/388 across 19 files**, lint, format,
  production/test TypeScript checks, build, Docker build (`zimaos-mcp-server:phase2e`),
  Compose config validation, and `git diff --check` — all passed. No Phase 2E live
  VM acceptance yet; GHCR publication of this image has not been verified.

## Pause checkpoint — post-Phase 2E live acceptance (2026-09-30)

Historical pause snapshot; the completed closing state at the top of this file
supersedes its dirty-worktree/next-action instructions.

- **Git / delegation:** `main` and `origin/main` both at
  `491e406e851470d4062c71087810cec8d07e6941`. Dirty tracked files:
  `src/zimaos/client.ts`, `tests/client.test.ts`, `docs/RESEARCH.md`, `STATUS.md`.
  No active child; no commit/push for the response-shape correction. Local integration
  credentials remain ignored and unstaged. Preserve this dirty work on resume.
- **Local gates on the corrected worktree:** mocked `npm test` **390/390 across 19
  files**, lint, format check, both TypeScript checks, production build, Docker
  build (`zimaos-mcp-server:phase2e-final`), Compose configuration validation,
  and `git diff --check` all passed. The first live test used the older
  `phase2e` image; the corrected image was rebuilt and retested.
- **Live disposable VM through authenticated MCP:** unauthenticated request 401;
  12 registered tools; benign Compose validation accepted without changing the
  one-app baseline. Modern risky first round returned native `input_required`
  without mutation. A separate default-off run denied both install and uninstall
  before mutation. With permissions enabled, a benign uniquely named disposable
  Compose app appeared after one MCP install call, duplicate install was blocked,
  and one MCP uninstall call removed it. Initial accepted responses were wrongly
  normalized as `upstream_error` despite the mutation; no automatic retry was
  attempted. A secret-safe live response-shape probe identified message-only
  HTTP 200 acceptance. With the narrow fix, another disposable benign app was
  installed and uninstalled through MCP; both calls returned `accepted`, and
  read-only observations confirmed appearance/disappearance. No risky workload
  was installed and no approved-risky second-round live mutation was attempted.
- **VM final state:** read-only MCP list returned only pre-existing
  `mcp-test-nginx`; the temporary acceptance container was stopped. A ZimaOS
  Custom App UI deployment was not exercised. GHCR status for the corrected
  uncommitted image is not verified. `update_app` remains unimplemented because
  actual App Store update semantics remain unverified.
- **Pause action:** no new child, scope expansion, further VM mutation, commit,
  or push after the pause request. On explicit resume, review the dirty diff,
  commit/push the corrected milestone, verify remote CI and GHCR, and report
  any remaining UI/client human-presentation limitation without claiming MCP
  cryptographically proves human presence.

## Phase 2A implementation verification (local, mocked)

- Started at `e1ba7b70bdbd8da3202877353d258360127065b1` with pre-existing
  uncommitted split-package manifest/lock changes; reconciled and retained them.
- `npm test`: 5 files / 55 tests passed (including modern and legacy HTTP paths,
  bearer boundary and 1 MiB rejection); `npm run lint`, `npm run typecheck`,
  `npx tsc -p tsconfig.test.json --noEmit`, `npm run format:check`, and
  `npm run build`: passed.
- `docker build -t zimaos-mcp-server:phase2a .` and
  `docker compose -f deploy/zimaos/docker-compose.yml config --quiet`: passed.
- Live ZimaOS integration was not rerun for Phase 2A. GHCR/CI for this milestone
  were not checked after the push. No Phase 2 provisioning tools yet.

## Research checkpoint verification / blockers

- Original scratch parser probe: 12 passed / 14 failed; defects/coverage recorded in research.
- Focused synthetic parser checks: 14/14 passed; no network or VM interaction.
- `npm run format:check`: passed (whole repo); only the three allowed Markdown files
  were targeted for formatting. `git diff --check`: passed. Checkpoint diffs reviewed;
  scope is docs-only. `.env.integration.local` is still Git-ignored (content not read).
- No runtime test/build, Docker build, SDK round-trip, or new live integration was run
  for this docs-only pass. Historical Phase 1 results below are not current reruns.
- `.env.integration.local` was not opened. No credentials or derived secret material
  were used or exposed. `AGENTS.md`, `PROJECT.md`, runtime, tests, dependencies, Docker,
  deployment Compose, and CI remain untouched.
- Review needed: modern-only risky approval, single-use/300-second/single-process proposal,
  client human-UI enforcement limit, explicit-name install proposal, parser limits/subset.
- Blocked semantics: App Store update transitions; uninstall storage effects and
  `uncontrolled` behavior. No additional live probes authorized in this checkpoint.
- GHCR/deployment: no Phase 2 image or deployment readiness claimed. Historical private
  Phase 1 image/Compose status is retained below; this docs push may trigger existing CI
  and publishing, but their new results will not be claimed without verification.

## Historical Phase 1 record (not rerun by this research pass)

## Correction-pass commits (Phase 1 session, all on `main`, all pushed)

- `docs(research): correct containers/healthcheck findings against live v1.7.1` — reconciles
  `docs/RESEARCH.md` with a secret-safe raw re-probe of the disposable VM (see "Live API shape
  re-probe" below).
- `ci(ghcr): tag every published build with immutable sha-<GITHUB_SHA>` — `.github/workflows/ghcr-publish.yml`.
- `docs(readme): add MCP client connection example and GHCR tag strategy` — `README.md`.
- This status-record commit (final HEAD of the pass).

## Committed & pushed milestones (all on `main`, all pushed)

- Core implementation (`34c8532`): strict TypeScript MCP server with typed ZimaOS client (login,
  bearer session, auto re-login on 401), domain services (apps/system), permission layer (app
  control disabled by default), Phase 1 tool set, authenticated Streamable HTTP transport +
  `/health`.
- Mocked test milestone (`864730d`): 52 vitest cases across 5 suites with a shared fake-fetch
  harness; covers config validation, client session behavior, permission layer, MCP tools over
  InMemoryTransport, and the HTTP transport (auth rejection, health readiness, authenticated round
  trip). Includes the `probeComposeAppHealth` fix.
- Docs handoff (`5302d4a`, corrected by `f9b4f3b`).
- Docker packaging (`bea0dc7`): multi-stage, non-root, prod-deps-only `Dockerfile` + `.dockerignore`.
  Committed only after the production image was built and live-exercised.
- Deploy Compose (`4cc69d7`): `deploy/zimaos/docker-compose.yml`, paste-ready for a ZimaOS Custom
  App (host-gateway networking, no privileged socket).
- CI + GHCR workflows (`b1046c9`): `.github/workflows/ci.yml` and `.github/workflows/ghcr-publish.yml`.
  Neither depends on the disposable VM; no VM credentials in Actions.
- Docs (`da7c1be`): `README.md`, Apache-2.0 `LICENSE`, `.env.example`, host-gateway research note in
  `docs/RESEARCH.md`.
- Status progress record (`b81fa2a`).
- Formatting normalization (`c889530`) and README tool-list correction (`8ff4dc6`).
- Phase 1 completion status (`ef4fcb8`), then manager commit `7366883` (AGENTS.md tracked-file
  mutation safety rules) — local checkout fast-forwarded to it before this pass.

## Automated test status (exact, re-run for the correction pass)

- **5 files / 52 tests — all passing** (mocked, no network). `vitest run` → "Test Files 5 passed",
  "Tests 52 passed".

## Full local quality gates — ALL PASSING (re-run against the committed tree)

- `npx prettier --check .` — **pass** ("All matched files use Prettier code style!"). One
  pre-existing non-conforming line in this file at HEAD was fixed by this rewrite.
- `npm run lint` (`eslint .`) — **pass** (0 errors).
- `npm run typecheck` (`tsc -p tsconfig.json --noEmit`, strict) — **pass**.
- Test type check (`npx tsc -p tsconfig.test.json --noEmit`, strict) — **pass**.
- `npm test` — **52/52 pass**.
- `npm run build` (`tsc -p tsconfig.json`) — **passes**; emits `dist/` (gitignored).
- Docker image build from the committed tree — **success** (multi-stage, non-root; no BuildKit
  frontend dependency).
- Compose validation (`docker compose -f deploy/zimaos/docker-compose.yml config --quiet`) —
  **pass**.

## CI status (GitHub Actions)

- **Workflow:** `.github/workflows/ci.yml` on push to `main`. Steps: install → format check (Prettier) → lint → typecheck → test typecheck (`tsconfig.test.json`) → tests → production build → Docker image build → Compose validation (`docker compose config`). CI now explicitly enforces both Prettier formatting and strict test TypeScript checking, matching the full local Phase 1 gate.
- **Result for the correction-pass push — success.** Run `36282720203`, rewritten-equivalent SHA
  `572785f3d14b05e9eba6995a5f0721f50ebb1675` (the correction-pass HEAD), conclusion **success**.
  CI does not depend on the disposable VM and contains no VM credentials.

## GHCR status

- **Workflow:** `.github/workflows/ghcr-publish.yml` on push to `main` (and `v*` tags), using the
  auto-provided `GITHUB_TOKEN`. No VM dependency, no permanent registry credentials or PATs.
- **Result for the correction-pass push — success.** Run `36282720213`, rewritten-equivalent SHA
  `572785f3d14b05e9eba6995a5f0721f50ebb1675` (the correction-pass HEAD), conclusion **success**.
- **Tags actually pushed (from the workflow log):** `latest` and immutable
  `sha-2573f9e02f016a3106ffd0b9c842b9594597bf0e`, both digest
  `sha256:f0b084a9…` (identical image — the immutable tag is a reproducible reference to exactly
  this build). This confirms the new commit-tag path works end-to-end in CI.
- **Tag strategy (implemented this pass):** every published build receives an immutable
  `sha-<GITHUB_SHA>` tag; pushes to `main` also publish `latest`; pushed `v*` release tags also
  publish the version tag and `latest`. Documented in README ("GHCR image references").
- **Package:** `ghcr.io/lvgvs/zimaos-mcp-server`, visibility **private** (inherits repository).
  Pulling requires a GitHub token with `read:packages` scope.

## Live integration status — full Phase 1 MCP matrix (authorized disposable VM)

Executed against ZimaOS v1.7.1 using `.env.integration.local` (never echoed; file remains
git-ignored and untracked). The server under test was the **production container artifact**
built from this repository's committed `Dockerfile`, run with `--env-file .env.integration.local`.

### Live API shape re-probe (RESEARCH.md reconciliation)

Secret-safe raw probe of the ZimaOS API (structure facts only; no credential values):

- `GET /v2/app_management/compose/{id}/containers` → HTTP 200 envelope containing **only**
  `{ data }` on live v1.7.1 (no `success`/`message`). `data = { main, containers }`;
  `containers` is a **map keyed by service name** (`nginx`), each value the container record
  (`ID`, `Name`, `Image`, `Service`, `State`, `Status`, `Health`, `Publishers`, ...). Not a flat
  array. Matches the implementation's normalizer.
- `GET /v2/app_management/compose/{id}/healthcheck` → HTTP **200** with a minimal body (no
  structured health-status data on this version); the HTTP status is the usable health signal,
  which is how `probeComposeAppHealth` treats it.

### Read path — all exercised through MCP (sanitized results)

- Unauthenticated `POST /mcp` → **401** (negative control).
- Authenticated `tools/list` → **9 tools**: `get_app`, `get_app_health`, `get_app_logs`,
  `get_system_info`, `list_app_containers`, `list_apps`, `restart_app`, `start_app`, `stop_app`.
- `list_apps` → 1 app: `mcp-test-nginx`, status `running`.
- `get_app` (`mcp-test-nginx`) → normalized details, status `running`.
- `get_app_health` → probe state **healthy**; 1 container (`nginx`, `running`).
- `get_app_logs` (bounded, `lines=20`) → non-empty bounded log text returned.
- `list_app_containers` → 1 container: service `nginx`, image `nginx:alpine`, state `running`,
  published port mapping present.
- `get_system_info` → real VM facts: hostname `ZimaOS`, OS version **v1.7.1**, arch `amd64`.

### Security / permissions — exercised through MCP

- Unauthenticated MCP request → **401** (above).
- With `ALLOW_APP_CONTROL=false`: `stop_app` returned the expected permission error
  `[APP_CONTROL_DISABLED] ... Set ALLOW_APP_CONTROL=true to enable it.` (tool-level error, no
  state change).

### Control path — exercised through MCP (`ALLOW_APP_CONTROL=true`)

Using the disposable test app `mcp-test-nginx`:

- `stop_app` → ok; polled status reached **exited** (~3 s).
- `start_app` → ok; polled status reached **running** (~3 s); health probe **healthy**.
- `restart_app` → ok (ZimaOS accepted the restart PUT); recovery verified: status **running**,
  health probe **healthy** on first poll. Note: ZimaOS recreates containers asynchronously and the
  compose-level status can read `running` throughout a fast recreation, so the stop transition was
  not separately observable in the final run; an earlier run did observe the intermediate
  container churn (port conflict during recreation) before recovery — consistent with async
  recreation, not a product defect.
- **Final state after all control operations:** `mcp-test-nginx` status **running**, health probe
  **healthy** — disposable test app restored to healthy/running as required.

## Documentation status

- Present: `AGENTS.md`, `PROJECT.md`, `DECISIONS.md`, `docs/RESEARCH.md`, `STATUS.md`, `README.md`,
  `LICENSE` (Apache-2.0), `.env.example`, `deploy/zimaos/docker-compose.yml`.
- README documents: setup, configuration (all env vars incl. `ALLOW_APP_CONTROL` default-off), the
  exact MCP tool list (verified against `src/mcp/tools.ts`), **MCP client connection example**
  (Streamable HTTP endpoint URL + `Authorization: Bearer <MCP_AUTH_TOKEN>`, no real secrets),
  **GHCR tag strategy** (`latest`, `v*`, immutable `sha-<GITHUB_SHA>`), ZimaOS Custom App
  deployment via the paste-ready Compose, and the private-image pull limitation.

## Secrets / integration env file

- `.env.integration.local` is **ignored** (`.gitignore:9:.env.*`), **untracked**, and **unstaged**.
  No secrets are committed or staged; no credential values were printed in this session's logs,
  docs, or status. Verified with `git check-ignore -v .env.integration.local` → ignored.

## Known limitations

- GHCR image is private (inherits repo visibility); consumers need a token with `read:packages`.
  Documented in README; no action required for Phase 1 scope.
- A live ZimaOS Custom App paste/install through the ZimaOS UI remains the one optional manual
  verification item permitted by PROJECT.md; the Compose file is validated and paste-ready, but
  was not pasted into the VM's UI in this session.

## Historical Phase 1 manual actions

- **None blocking.** No privileged or manual step is needed for Phase 1 completion.
- Optional: paste `deploy/zimaos/docker-compose.yml` into a ZimaOS Custom App on the disposable VM
  as an end-to-end UI verification (the container artifact itself is already verified).

## Historical Phase 1 handoff note

The Phase 1 manager handoff above predates Phase 2. Current Phase 2 completion
state and manager action are recorded at the top of this file.
