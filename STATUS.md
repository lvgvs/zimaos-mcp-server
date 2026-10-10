# Status

## Phase 6 — Native App Store Installation

**Current milestone:** parent-implemented native-store installation and disposable live UAT
complete (2026-10-10); delivery is one protected-main OPEN, UNMERGED PR for manager review.
Branch `feat/app-store-install`; <https://github.com/lvgvs/zimaos-mcp-server>.
Reviewed preservation `fb1baed66910df288c61aa357769ef690aedb017` and its prior history remain intact.
Tested runtime checkpoint: `5c08116b9140e476aa0dd8876b53c70ac0fae665`.
The containing documentation commit/final delivery SHA, PR URL and exact-head CI/CodeQL results
are authoritative in Git and the final PR handoff, not recursively embedded here. Base/main remains
`e9fa328c2ecd6e49eebc7741d66bdfbe5046e23f`.

**Implemented:** sole new tool `install_app_from_store({repo_id, app_id})`; strict two-string
schema (128/192-character bounds), shared identity validation and no extra options. Enabled
registered v2 HTTP/Compose-class/current server-selected amd64/arm64 only; configured host/proxy
paths, no caller URLs, fallback or force/update/downgrade. Canonical final association bytes feed
analysis, controlled dry-run, modern signed expiring single-use intent approval and one real POST.

**Safety integration:** shared preflight awaits the installed-association scan before dry-run;
generic installation remains unchanged. At most 128 installed identities, internal supported
identity-only YAML projection with byte/time/encoding/redirect bounds; raw credential-bearing
public Compose still rejects. Existing canonical ID conflicts across name/repo changes, and
opaque/malformed/aliased/unreadable evidence fails closed. Both install surfaces share the queue
and name reservations; native IDs also reserve until restart for accepted/uncertain attempts,
including after uninstall. Definitive rejection releases reservations; bounded exhaustion denies.
Default-off `ALLOW_APP_INSTALL` gates both install tools; no new permission or legacy approval bypass.

**Mutation/readback:** explicit `dry_run=false&check_port_conflict=true&uncontrolled=false`,
exact final source, no mutation retry. `accepted` is not completion. One immediate list, and at
most one container read/health probe when the exact project is visible, reports observed/pending/
unknown and optional observed app ID, container count and health. No polling or rollback guarantee.

**Executed local gates:** 641 mocked tests in 35 files; formatting, lint, production TypeScript,
strict test TypeScript, production build, Docker build (`zimaos-mcp-phase6:local`), canonical
deployment Compose validation, whitespace and exact-secret/retained-fixture privacy checks passed.
Tests cover adversarial resolution, awaited conflicts, generic/native serialization, disabled
policy, risky exact-byte/selection binding, authenticated modern HTTP continuation, replay,
cross-operation/legacy denial, one-shot uncertainty/rejection and bounded observations.

**Live UAT:** separate benign current native fixture, exact controlled dry-run/install fingerprint,
async acceptance with pending immediate reconciliation, later running-container observation,
installed/catalog canonical association, existing MCP reads, duplicate denial without a second
POST, supported uninstall and subsequent absence all passed. Initial scratch-harness envelope
mistake caused cleanup without completion assessment; the user explicitly authorized one corrected
new lifecycle after verified absence. Two isolated lifecycles total, one install and cleanup each,
not an ambiguous retry. Preexisting IDs/status/health/association and retained-fixture Compose
fingerprints were restored; the Phase 5 checkpoint is byte-identical. Fixture identity/version/
image/port/VM details remain local-only. Risky cases and arm64 are mocked, not live-UAT claims.

**Preserved Phase 5:** ON HOLD / Outcome B DEFER; its existing resume trigger and evidence remain
unchanged. Retained native update fixtures must remain untouched and their identities/baselines
local-only. No update implementation or update UAT is authorized.

**Quota/delegation:** this resumed continuation was parent-only, no Qwen/child/subagent use.
Earlier accepted child work remains historical; rejected unfinished preflight work was not reused.
Fresh readable `usage_api` checkpoints: final documentation review 50% session / 22% weekly;
immediately before PR creation 48% / 22%, both NORMAL. Earlier integration/UAT quota calls
succeeded, but their numerical outputs were not retained in the compacted handoff and are not
reasserted here. No automatic reset, parent substitution or AGENTS edit occurred. Final quota
and exact-head delivery verification are in the handoff.

**Release/deployment:** no Phase 6 GHCR publication or release authorization. Local production
image and deployment Compose validate; existing public v0.1.0 remains unchanged and does not
contain this unreleased tool. Read-only verification matched Release/asset/tag IDs, the asset's
recorded SHA-256 and v0.1.0/stable/latest/release-source image digests against approved anchors.
No version/configuration/deployment YAML changes or base-OS/fixture reconfiguration.

**Limitations/blockers/manual action:** no implementation/UAT cleanup blocker. Registered v2 HTTP
Compose/amd64-arm64 scope only; identities come from normal catalog/UI, no discovery tool.
Reservations/approval are process-local and bounded, not durable/cross-replica/upstream CAS.
Accepted/uncertain native reservations survive uninstall until restart; reconcile before recovery.
No external-writer race, rollback or general storage-retention guarantee. Manager should review the
checked final PR and these documented decisions; do not merge, publish, resume Phase 5 or start
another phase under this authorization.

The following Phase 5 correction is a historical delivery checkpoint, not current Phase 6 scope.

## Historical Phase 5 — ON HOLD lifecycle correction

**Current milestone:** Phase 5 remains the active update phase, ON HOLD, not closed or completed.
Outcome B is the current implementation decision: defer `update_app` until the remaining native
target/effects/class/result contract gaps are resolved. No `update_app` or `ALLOW_APP_UPDATE`
implementation/configuration is shipped. The accepted safety decisions and technical evidence
are unchanged; force, Compose edit or reinstall is not a substitute for verified native update.

**Merged research milestone:** [PR #24](https://github.com/lvgvs/zimaos-mcp-server/pull/24) is
MERGED. Historical squash merge: `8cd3c2e87638716deea9c178450695ebca6f251a`. It was a valid
research/documentation milestone, not completion of Phase 5. Canonical repository:
<https://github.com/lvgvs/zimaos-mcp-server>. This lifecycle correction uses
`docs/phase5-on-hold` from that clean synchronized main baseline; the containing commit and
exact-head checks are recorded in Git and the correction PR handoff.

**Retained native update fixtures:** genuine native App Store fixtures are intentionally retained
in the authorized disposable VM specifically for future genuine native update UAT. None currently
has a naturally available update. Their identities, versions, images, configuration and detailed
baselines remain in the existing local scratch checkpoint only, not tracked documentation.
No genuine native update transition UAT has been performed.

**Resume trigger:** a genuine naturally available native App Store update on a retained fixture,
or new version-applicable authoritative upstream evidence sufficient to close the remaining
contract gaps. Resume Phase 5 from preserved evidence, not as a brand-new phase. Implementation
still requires the verified update contract, meaningful risk boundaries, independent default-off
permission, one mutation attempt, no ambiguous retry and completion observations distinct from
asynchronous acceptance.

**Secondary install finding:** for the tested Compose-class entries, the normal UI used trusted
catalog/detail lookup, architecture-appropriate Compose and canonical association metadata with
the supported Compose POST and explicit `uncontrolled=false`; no distinct store-install mutation
API was observed. A bounded extension/thin store-aware frontend appears sufficient, but current
`install_app_from_compose` does not implement the complete native-store contract. This is an
observation, not authorization for a new store tool or universal equivalence with arbitrary Compose.

**Correction scope/validation:** documentation only; PROJECT, STATUS and RESEARCH change.
DECISIONS remains valid and unchanged. Local formatting, lint, production/test TypeScript checks,
mocked tests (500/500 in 28 files), production build, Docker build and deployment Compose validation
passed. Diff/scope, secret/privacy and whitespace review precede commit; exact-head protected-main
CI results belong in the correction PR handoff. No runtime, tests, configuration, workflow,
deployment, release/version/tag, v0.1.0, stable/latest or existing Release/Compose asset changes;
no new live VM operations are authorized or performed by this correction.

**Blockers/manual action:** no user/manual runtime action is currently required except waiting
for a genuine update/evidence trigger. Manager review of this documentation-only PR is separate
from Phase 5 resumption. Leave the correction PR OPEN and UNMERGED; do not implement an App Store
installer, perform update UAT or begin another phase.

The following sections are historical checkpoints, not current authorization/state.

## Historical Phase 5 Outcome B research delivery checkpoint (2026-10-09)

**Current milestone:** Outcome B research/native-store closure published in
[PR #24](https://github.com/lvgvs/zimaos-mcp-server/pull/24), OPEN and UNMERGED on
`feat/update-app` for manager review. Canonical repository:
<https://github.com/lvgvs/zimaos-mcp-server>. Verified development base commit:
`d6c65ae0015f1cbf17b95e5b66448733c2d60644`. Research checkpoint commit:
`d4d3d631f0c3f559a5f1a43746b3ced8fca29def`; final delivery metadata commit/latest-head CI
is recorded in the PR and final handoff rather than recursively embedding its own SHA here.

**Outcome B:** no sufficiently clean current native update target/effects/class/result contract
was established. No `update_app`, update permission/configuration, or speculative discovery tool
is shipped. This is not a claim that updates are unsupported, and no candidate/404-only inference
is used. Verified legacy source/SDK, earlier forced associated-Custom-Compose transition, native
fixture evidence and exact reopening criteria are recorded in RESEARCH; PROJECT records final
scope, DECISIONS rejects a force/edit/reinstall workaround. README/config/release files need no
change because no capability ships. Existing AI disclosures are untouched.

**Genuine live fixtures:** community IT Tools (`big-bear-it-tools`, pinned catalog image) and
official BentoPDF (`bentopdf`, version/image 2.8.8), installed through ordinary App Store UI,
one supported Compose POST each. Both had canonical catalog/repo IDs, resolvable installed and
catalog Compose, no volumes and no available update. The original two non-store apps lack those
canonical/repo IDs and have fixture-specific catalog 404s; store IDs and false controlled/update
flags alone do not prove origin. Normal UI history establishes the native origins. All six MCP
read tools plus stop/start/restart worked on both IDs, with state/health readback. No fixture
Compose was edited. No genuine native update candidate or live native update/permission UAT was
possible; forced custom characterization is not relabeled native acceptance testing.

**Cleanup verified:** one MCP uninstall request per native fixture, explicit
`delete_config_folder=false`, then supported readback verified both absent. Only
`compose-3312d0c25fc48cbe` and `mcp-test-nginx` remain; unrelated apps/data were not removed.
The earlier custom fixture had already been removed. No OS/host/internal-file control was used.

**Secondary finding:** native catalog discovery/detail and official Compose retrieval work.
Both tested native install mutations used the documented Compose POST with repository metadata,
not a verified distinct native-ID mutation API. A future store-install capability needs trusted
selection/association/risk checks; universal equivalence with arbitrary imports is unproven.
No App Store install tool was implemented.

**Executed local gates:** format check, lint, production/test TypeScript checks, mocked tests
**500/500 in 28 files**, and production build passed after final live cleanup. Cached production
Docker build (`zimaos-mcp-server:phase5-research`), canonical deployment Compose validation,
final diff/scope/secret checks and credential-ignore verification also passed. Research checkpoint
CI [37967344948](https://github.com/lvgvs/zimaos-mcp-server/actions/runs/37967344948) passed all
three required jobs; CodeQL [37967342909](https://github.com/lvgvs/zimaos-mcp-server/actions/runs/37967342909)
passed both analyses and its aggregate check. PR readback confirmed expected head, OPEN/unmerged,
no auto-merge and no unresolved review threads. This status-only delivery update must also pass
latest-head PR checks; their final evidence belongs to the live PR/final handoff.

**Delegation/quota:** Qwen performed substantial research, not Git/source/README authoring. Last
native-store child hit its 50-call cap without writing its report; parent preserved/reviewed its
handoff and verified only decisive current schema/documentation facts. No VM implementation
revision mapping was established. Permanent AGENTS quota guard remains the single original
authorized edit (installed at 30% session / 54% weekly remaining); the earlier CAUTION
checkpoint/pause is retained below. Latest decisive-review usage: 96% session / 45% weekly
remaining, normal. No quota redemption or parent-model substitution was performed.

**Release/deployment:** immutable v0.1.0/tag/Release/GHCR aliases/Compose asset remain out of scope
and untouched. Read-only verification matched the approved post-PR23 Release body/metadata,
tag source, asset ID/bytes/SHA-256 and four public image aliases at the original digest; only
the asset's mutable public download counter advanced. No new Phase 5 image publication is
authorized. Existing v0.1.0 deployment remains the public digest-pinned Custom App artifact;
no update capability is advertised.

**Blockers/manual action:** current upstream update contract/mapping and genuine transition
evidence required to reopen implementation; no VM cleanup or credential entry remains for the
user. Manager should review the final Outcome B OPEN PR; do not merge or begin a later phase.
The following sections are retained chronological checkpoints, not current authorization/state.

## Historical resumed native App Store characterization (2026-10-09)

Manager authorized resume on the existing `feat/update-app` worktree. Fresh live usage:
session 82% / weekly 49% remaining (normal); HEAD/main/origin-main remain
`d6c65ae0015f1cbf17b95e5b66448733c2d60644`, with the same four Markdown files modified.
No AGENTS edit. Prior verified provenance and disposable forced-update observations are retained;
the interrupted mapping child's public-source leads remain pending decisive parent verification.

**Evidence correction:** manager confirms the two baseline apps are non-App-Store installations
(the disposable test app and MCP server). Association-like metadata and their catalog-Compose
404s do not establish native App Store origin or lack of native retrieval/update support.
This resume will use the normal supported App Store flow to create a genuine benign fixture,
verify existing MCP reads/control, then return to update eligibility/semantics. Catalog install
is secondary research only, not a new feature authorization. Outcome A/B/C remains open.

**Native fixture checkpoint:** installed IT Tools from the community App Store and BentoPDF
2.8.8 from the official Zima App Store, both via ordinary UI Install, one Compose POST each.
Both have zero volumes; BentoPDF's inspected catalog Compose had no detected elevated risk.
Catalog discovery/detail uses v3 app-store paths; both native mutations used documented v2
Compose POST with repo association. Installed/catalog Compose retrieval returned 200 for both.
Non-store baseline 404s remain fixture-specific. All six existing MCP read paths and stop/start/
restart worked on both stable IDs with state/health readback. No existing app or fixture Compose
was edited. Both report `is_uncontrolled=false` and no available update;
the upgradable list is empty. RESEARCH contains precise metadata/field limitations.

Both fixtures remain running for the remaining update research; cleanup is pending until they
are no longer useful. A bounded Qwen native-install/update-eligibility research task is running;
Hermes owns decisive review. No shipped update code, native update mutation, outcome, commit,
push or PR yet. Current usage after this bounded live pass: session 67% / weekly 46% remaining,
normal. Next: review child evidence when returned and resolve supported candidate/target semantics
without manufacturing an old version or treating lack of available updates as lack of support.

## Historical Phase 5 manager pause (2026-10-09)

Phase 5 is paused; the verified checkpoint below is preserved, not authorization to continue.
The existing Qwen runtime-mapping child `sa-0-77ff3af3` was narrowly interrupted after its
latest recorded short schema-inspection commands returned. No new child was launched.
Its unfinished public-source findings are **UNVERIFIED / pending Hermes review**, not project
facts. A short preservation note, public downloads and transcript snapshot are retained under
profile scratch: `phase5-pause-checkpoint.md` and `phase5-pause-evidence/`; the original transcript
is `cache/delegation/live/deleg_e49cc85e/task-0.log`. Completion now confirms **interrupted**
while waiting for a model response; no final research report was returned. The superseding
steer did not land before termination. Preserve the transcript/artifacts for later review;
the child is no longer running.

Last verified work remains the disposable IT Tools PATCH characterization and cleanup below.
Runtime implementation mapping, controlled-store availability semantics, exact acceptance
normalization and Outcome A/B/C remain unresolved. No substantive child review, further research,
implementation, UAT, full gates, commit, push or PR occurred during pause preservation.
AGENTS and PROJECT were not edited for this pause; v0.1.0 and its published artifacts are untouched.
On explicit manager resume: reread this checkpoint, recheck live Codex usage and Git state, then
review the preserved partial child evidence before selecting any further work; do not repeat
completed provenance research. Until then, stop.

## Phase 5 last verified checkpoint (2026-10-09)

- **Milestone:** update-app investigation in progress; Outcome A/B/C not yet selected.
  Working branch `feat/update-app`, base/current HEAD
  `d6c65ae0015f1cbf17b95e5b66448733c2d60644`;
  canonical https://github.com/lvgvs/zimaos-mcp-server. No Phase 5 commit, push or PR yet.
- **Completed:** Phase 5 authorization appended to PROJECT; one-time manager-authorized
  parent-model quota guard installed in AGENTS and its isolated diff verified. Installation
  live usage: 30% session / 54% weekly remaining (controlling 30%, normal). Before reviewing
  Qwen's result: 26% session / 54% weekly (controlling 26%, normal); neither caution nor hard
  stop entered at these checkpoints.
- **Delegation / parent verification:** Qwen finished bounded official discovery/repository
  analysis without tracked edits. Hermes pinned and independently inspected the decisive
  official CasaOS-AppManagement spec/handler/service. RESEARCH records corrections: control
  permission reuse is forbidden; omitted-force equivalence, reliable rollback/storage retention,
  and successful completion from idle/disappearance are not established. Community mirror
  attribution is corrected. No speculative implementation accepted.
- **Actual verification:** AGENTS Prettier and diff checks passed at installation; formatting
  and diff checks passed for all four changed Markdown files at this research checkpoint.
  Production build passed on resumption. Full tests/lint/typechecks/Docker/Compose gates have
  not yet been rerun. Fresh raw-API disposable update characterization is recorded below;
  no shipped MCP update tool or UI UAT claim. Phase 4 results remain historical.
- **Remaining:** current ZimaOS API/fixture/effects/observability verification and outcome choice;
  eventual full local gates and checked OPEN, UNMERGED PR. No new manager product decision
  identified yet. Published v0.1.0/artifacts and deployment files remain unchanged; no Phase 5
  image or new deployment readiness claimed. Preserve the completed scratch report rather than
  rerunning bulk child discovery. No manager action required by this checkpoint.

**Focused follow-up completed:** Qwen's second bounded research report is preserved in profile
scratch; no child remains running. Hermes checked live usage before review (21% session / 53%
weekly remaining, normal), verified published SDK integrity/gitHead, actual Git tag target and
official guide/explorer in the browser. Matching SDK/source provenance is not proof of the VM's
binary version or omitted-force server binding. No speculative implementation accepted.

**Fresh read-only VM evidence:** v1.7.1, two pre-existing apps; generated Compose app running,
`mcp-test-nginx` exited. Neither has an available update. Both contain association metadata but
their store Compose lookups return 404; upgradable list is empty. Supported catalog GET and
bounded nested traversal identified possible fixture candidates. Credentials remained ignored
and unprinted; no existing app was changed. RESEARCH records failed scratch response-bound and
shape assumptions as well as the corrected successful read, not fabricated update acceptance.

**Historical quota-caution checkpoint:** controlling live usage reached 15% (session 15%, weekly
52% remaining), entering CAUTION, not HARD STOP. Finish this bounded evidence/documentation
checkpoint rather than beginning a new large implementation or live mutation package. Changes
remain uncommitted in AGENTS, PROJECT, STATUS and RESEARCH; no release/ref/image change. On
resumption check live usage and Git state, retain both completed child reports and primary-source
scratch evidence, then inspect a resolvable benign catalog candidate (e.g. `big-bear-it-tools`)
and design the one-shot disposable update characterization before making any real mutation.
Do not use either pre-existing app as the fixture. Outcome/implementation/full gates/OPEN PR
remain unfinished; this is a quota-caution checkpoint, not a new manager approval requirement.

**Resumed verification:** live usage on resume was session 100% / weekly 51% remaining,
controlling 51% (normal); after this bounded live pass, session 93% / weekly 50%, normal.
Existing diff and complete current project-state files were read; AGENTS was not edited again.
Supported app-management `/info` reports architecture only, not a build/version. A new bounded
Qwen task is checking only the remaining public v1.7.1 service implementation mapping, without
repeating completed provenance research; its result is pending parent quota check/review.

**Candidate/live findings:** three registered catalog Compose candidates resolved. IT Tools
had no detected elevated risks and no volumes; Homepage was excluded for Docker-socket access.
A fresh benign IT Tools fixture with a verified older image tag was dry-run validated and
installed once. It reported uncontrolled=true/updateAvailable=false. Explicit force=false PATCH
was a no-op; one separate force=true PATCH was asynchronously accepted and later observed at
the store target version in both Compose and the running container. Health was 200; selected
marker/label/port fields persisted. Initial Compose/health read preceded container recreation,
so it was not treated as completion. No rollback or general retention guarantee was established.
The fixture was deleted once and exact baseline IDs/statuses restored; both pre-existing apps
were untouched. Detailed limitations and supported request paths are in RESEARCH.

**Next bounded step:** review the pending mapping evidence, characterize the ordinary controlled
store availability path and exact acceptance envelope if safely justified, then choose A/B/C.
Do not infer product support from the successful forced uncontrolled-fixture update. No code,
commit, push, PR, stable release/image/asset change or new manager product decision yet.

## Phase 4 final durable-documentation checkpoint (2026-10-09)

- **Release line / publication record:** `v0.1.0` is the selected first stable release;
  package/lockfile version is `0.1.0`, changelog date 2026-10-09. Publication state is authoritative
  in Git tags, GitHub Releases and GHCR aliases rather than this source document.
- **Completed history/privacy reconciliation:** PR #20 was Squash merged, its author used the
  approved GitHub noreply identity, GitHub signing verified, exact-head CI/CodeQL/GHCR passed,
  and tracked superseded SHA/private-email occurrences were zero. Old directly resolvable
  GitHub objects are accepted; no Support/purge work is requested. The local-only rewrite
  safety ref remains retained until separately authorized cleanup.
- **Runtime evidence:** external runtime UAT is complete on the source tree now reachable as
  `c66254b218afd9436e5931e66518ece88ff58c5e` and unchanged tested image digest
  `sha256:78d1e7720d844f72b472d671cca2691c87069a87b78d9d7649ab6945a8d57535`.
  Its OCI revision predates the metadata-only history rewrite. No external UAT was repeated
  for that rewrite, reconciliation, or this documentation checkpoint.
- **Intended release source:** the protected-main squash merge containing this final durable
  checkpoint, not an earlier reconciliation artifact. Its exact SHA/digest/checks are validated
  in the external release handoff and Git/workflow records. Approved tag-driven promotion reuses
  the existing exact-main artifact; publication needs no follow-up source-content/status commit.
- **Scope / verification:** documentation only; publication-state prose is valid on both sides
  of release. Historical checkpoints below retain period-correct statements, not current gates.
  Release notes and AI disclosures are unchanged; runtime, dependency, deployment, workflow,
  permission and security behavior are unchanged. No local model/child/delegation or live tests.
  Formatting, lint, production/test TypeScript checks, all 500 mocked tests across 28 files,
  production build, Docker build, Compose validation and whitespace checks passed locally.
- **Preparation record:** branch `docs/v0.1.0-durable-release-state`;
  canonical https://github.com/lvgvs/zimaos-mcp-server. Exact containing SHA is available from Git.
  Manager review governs the PR; explicit release authorization governs tag/Release/promotion.
  Known limitations remain below; no new runtime blocker or architecture decision was found.

## Historical Phase 4 protected-main history-rewrite reconciliation (2026-10-09)

- **Recovery / current milestone:** clean local `main == origin/main` at
  `d05283357e42780e02484de6727b97ce53e5c325` before this PR; tree
  `6db09806fc394ce0aa138f842bb0416e01f74f77`. Protect main is active with no bypass,
  non-fast-forward protection, PR requirements and all three required checks intact.
  No release tag or GitHub Release exists. Working branch `docs/history-rewrite-reconciliation`;
  canonical https://github.com/lvgvs/zimaos-mcp-server. Exact containing commit is available from Git.
- **Completed rewrite:** seven consecutive commits were reconstructed with the repository's
  GitHub noreply author email; trees, full messages, names, timestamps and committer metadata
  were preserved. Parent identities necessarily changed; invalidated GitHub signatures were not
  copied. No source-content change. The local-only safety ref is retained untouched.
  Old GitHub commit objects may remain directly resolvable; the manager accepts this and does
  not request Support/purge work. This is not a release blocker.
- **Reference audit / changed components:** all tracked files audited. Runtime/source links
  identify reachable tree-equivalent commits; historical baselines are explicitly equivalents.
  The old immutable GHCR tag spelling is generalized while its actual digest/workflow evidence
  is preserved, not renamed to an unpublished replacement tag. Changes are limited to STATUS,
  PROJECT, CHANGELOG, release guidance and research. READMEs/AI disclosures and proposed public
  notes are unchanged. No runtime, tests, dependencies, Docker, deployment, workflows, security
  behavior, permissions, external UAT or delegation changed/occurred.
- **Runtime UAT / artifact boundary:** accepted source tree is now reachable as
  `c66254b218afd9436e5931e66518ece88ff58c5e`; accepted image remains
  `sha256:78d1e7720d844f72b472d671cca2691c87069a87b78d9d7649ab6945a8d57535`.
  Its OCI revision predates the metadata-only rewrite. External UAT was not repeated.
  Baseline main CI/CodeQL/GHCR runs succeeded; its artifact is not the final release source.
- **Local verification:** formatting, lint, production/test TypeScript typechecks, all 500 mocked
  tests across 28 files, production build, Docker build, Compose validation and whitespace checks
  passed. Privacy scan: zero occurrences of all seven superseded SHAs and of the previous private
  email in tracked files. No live integration/Inspector tests or mutations were run.
- **Manager gate:** open one docs-only PR and stop unmerged for manager review.
  If approved and merged, that final protected-main merge
  becomes the release-source candidate; exact SHA/digest/checks belong in the verified PR/release
  handoff, without another status-only publication. No tag/Release/promotion is authorized.
  Existing limitations remain; no new architecture decision or factual runtime blocker found.

## Historical Phase 4 final release-metadata checkpoint (2026-10-08)

- **Current milestone:** manager-selected first release version `v0.1.0`; dated changelog
  and proposed public release notes prepared, not published. Phase 3 remains the feature cutoff.
  Tag creation, `v0.1.0` / `stable` / `latest` promotion and GitHub Release require final manager approval.
- **Recovery / Git:** fetched origin; clean synchronized `main` at
  the source tree now reachable as `5ff304423e937f71f4a5e08994e4ab1b173566e9`, no staged/unstaged/untracked work or stashes,
  and no interrupted release-metadata branch. Unrelated bearer-fix branch preserved.
  Working branch `docs/v0.1.0-release-metadata`; repository https://github.com/lvgvs/zimaos-mcp-server.
  Exact containing commit is available from Git; final merged SHA/digest belongs in the PR handoff.
- **Changed components:** changelog first-release facts moved unchanged below an empty
  `[Unreleased]` into `[0.1.0] - 2026-10-08`; release guidance/scope/status distinguish version
  selection from publication approval. Proposed notes: `docs/RELEASE-NOTES-v0.1.0.md`.
  Package/root lock versions all verified as `0.1.0`, with no edits needed. Accurate README
  pre-release wording and EN/TR parity remain unchanged, including AI disclosures.
- **UAT identity / scope:** external runtime acceptance remains tied to
  the source tree now reachable as `c66254b218afd9436e5931e66518ece88ff58c5e` and
  `sha256:78d1e7720d844f72b472d671cca2691c87069a87b78d9d7649ab6945a8d57535`.
  No external UAT repeated, runtime/dependency/Docker/deployment/workflow/security changes,
  child/subagent delegation, release tag, GitHub Release or stable/latest promotion.
- **Verification:** local format check, lint, source/test TypeScript checks, 500/500 mocked tests
  (28 files), production build, Docker build (`zimaos-mcp-server:release-metadata`), Compose
  config validation and diff checks passed. Exact-head CI/CodeQL/trusted-main GHCR still require
  verification before handoff. The new metadata-only main artifact is the intended promotion source candidate,
  subject to manager approval, not a newly externally runtime-tested artifact.
- **Blockers / next manager action:** no new factual runtime blocker found; existing limitations
  remain documented below. Review the exact source/digest and proposed notes, then explicitly
  authorize actual release actions. No new architecture decision requires review.

## Historical Phase 4 final external runtime-UAT checkpoint (2026-10-08 UTC)

- **Current milestone:** external runtime UAT is complete, based on manager/user-reported
  normal-user results. Phase 4 still awaits explicit first version/tag/GitHub Release approval;
  Phase 3 remains the feature cutoff. No later-phase work or release publication is authorized.
- **Reachable tree-equivalent runtime-tested source:** `c66254b218afd9436e5931e66518ece88ff58c5e`.
- **Runtime-tested image:**
  `ghcr.io/lvgvs/zimaos-mcp-server@sha256:78d1e7720d844f72b472d671cca2691c87069a87b78d9d7649ab6945a8d57535`.
- **Completed runtime gates:** fresh normal-user Custom App installation / first start / health;
  modern `2026-07-28` discovery/tools list and reads; independent default-off permissions;
  enabled start/stop/restart, benign Compose install/uninstall and read/validate/edit;
  modern risky approval + positive MRTR continuation + risk-removing repair; wrong MCP token,
  wrong ZimaOS credentials and unreachable URL failure modes; app restart and full VM reboot
  persistence; release-candidate upgrade; MCP server uninstall and clean canonical-YAML reinstall.
  Clean reinstall used the exact digest, not generated old `x-casaos` / `store_app_id` metadata,
  and constitutes the passed fresh normal-user runtime installation UAT.
- **Risky-flow evidence:** only `cap_add: [CHOWN]` was introduced on `mcp-test-nginx`.
  Inspector disclosed operation/target/base/exact UTF-8 proposal hashes, introduced risk delta,
  expiry within 300 seconds, and a boolean control; explicit user approval led to
  `accepted` / `changed` and confirmed CHOWN readback. Removing only `cap_add` validated with
  `requiresApproval=false`, applied with `accepted` / `changed`, preserved the benign marker,
  and left app health healthy / nginx running. Exact readback hashes and all reported gates
  are recorded in `docs/RELEASE.md`; this is targeted repair, not a general rollback guarantee.
- **Failure semantics:** initial upstream login failure exits before MCP/health listening,
  so bad credentials/URL can produce connection refused, not `/health` 503. Repeated bad-login
  restarts triggered ZimaOS rate limiting. Correcting credentials/URL restored 200 / `ready:true`.
  A running server's authenticated readiness probe may return 503 for degraded readiness.
- **Recovery / scope:** found clean synchronized `main` at the runtime-tested SHA, with no
  staged/unstaged/untracked docs work, stashes or existing final-UAT branch. A transient DNS
  fetch failure cleared on retry. Working branch `docs/phase4-final-runtime-uat`; canonical
  https://github.com/lvgvs/zimaos-mcp-server. Primary-only reconciliation, no delegation,
  new external runtime tests/mutations, runtime changes, dependency changes or architecture decisions.
- **Verification / publication:** local format, lint, source/test TypeScript checks,
  500/500 mocked tests (28 files), production build, Docker build
  (`zimaos-mcp-server:phase4-final-uat-docs`), Compose config validation and diff checks passed.
  Exact-head CI/GHCR must also be verified. Record final merge SHA/digest in the PR handoff, not another
  STATUS-only publication commit. A newly published docs-only image is distinct from the
  runtime-tested digest above; external UAT was not rerun on it.
- **Preserved boundaries / next manager action:** Inspector Web must use browser-local loopback
  or trusted HTTPS with browser security enabled. The LAN-origin failure was Inspector-side,
  not a modern server defect. Modern native approval remains required for risky install/edit;
  legacy read/permitted benign operations remain available, with risky calls fail-closed and no
  shim/text bypass. Existing AI disclosures remain unchanged. Public source/GHCR access is approved;
  no fresh-install/UAT blocker remains. Review the checkpoint and approve the first version,
  source artifact and release notes when ready; do not create a tag/release before approval.

Earlier dated checkpoints below are historical evidence, not outstanding UAT instructions;
this final runtime-UAT checkpoint supersedes their pending installation / approval UX gates.

## Historical Phase 4 Inspector Web negotiation diagnosis (2026-10-08 UTC)

- **Baseline / recovery:** canonical https://github.com/lvgvs/zimaos-mcp-server;
  branch `fix/modern-protocol-discovery`, baseline
  the source tree now reachable as `dc0dad800b57019122b0e584ddc7473fc39fe3d1`, equal to the then-current `origin/main` tree before edits.
  Repeated interruptions left no source changes, commits, pushes or defect PR.
  Interrupted Qwen research produced no usable edits; replacement read-only research's
  claimed missing SDK discovery support was independently disproved and rejected.
- **Root cause:** official Inspector 2.9.0 Web request tracking calls
  `crypto.randomUUID()` on a non-secure, plain-HTTP LAN page origin. Chromium exposes
  no such function there. The client throws before `/api/mcp/send`; its browser probe
  classifier masks that TypeError as no modern evidence and emits the reported pinned
  version error. This is not a server negotiation defect. No runtime/dependency,
  legacy, approval, permission or security-policy change is justified.
- **External diagnostics, not UAT acceptance:** reproduced the exact Web error using
  the configured MCP credential; backend connect/events returned 200, but discovery
  was never sent. The same remote endpoint through loopback Web Inspector negotiated
  `2026-07-28`: discovery POST 200 JSON, matching protocol/method headers,
  `supportedVersions: ["2026-07-28"]`, followed by successful tools/list. No application
  tool mutation or risky approval was attempted externally. The manager's external TUI
  success and earlier local Web success remain consistent with this origin dependency.
- **Candidate unchanged:** manager-reported deployment is
  `ghcr.io/lvgvs/zimaos-mcp-server@sha256:5ee845a9d8cc99cfb8d808168c5a1f141064e5314a8adc6ea10bbc35f4e07495`.
  No new runtime artifact is needed for this diagnosis; public GHCR access remains the
  previously verified release checkpoint, not a new visibility audit.
- **Documentation / verification:** README EN/TR explain client compatibility and the
  Inspector secure-origin requirement; existing AI disclosures remain unchanged.
  Local format, lint, source/test typechecks, 500/500 tests (28 files), and build passed;
  the 43 HTTP/approval tests prove modern input-required and legacy fail-closed behavior
  with mocked ZimaOS services. No new automated tests or architecture decisions.
- **Remaining gate at diagnosis (now passed above):** manager reruns the affected Web connection and risky-approval UX
  from browser-local loopback or trusted HTTPS. Remote localhost must not be confused
  with the browser's own localhost. Do not disable browser security, add a legacy shim,
  or change server authentication/CORS to work around this client-side failure.
  Real-user UAT and final tag/release approval remain manager-owned.

ZimaOS MCP Server. This file is written so a fresh implementation chat can resume
without prior conversation context. Read `AGENTS.md` and `PROJECT.md` first; they are
authoritative.

## Historical Phase 4 public image access complete — then awaiting fresh-install UAT (2026-10-07 UTC)

- **Source / baseline:** https://github.com/lvgvs/zimaos-mcp-server is PUBLIC. Clean `main`
  was synchronized at the source tree now reachable as `26adf8d403c92cc6cf5d295741c7eb9a5b136278` before this documentation
  update. Working branch: `docs/phase4-public-image-checkpoint`; Hermes/local Git retains
  commit/push ownership. This STATUS-only change follows the protected-main, Squash-only PR
  workflow; no direct-main push or child/subagent delegation.
- **Security detour closed:** PR #10 was Squash-merged at that baseline. CodeQL alert #1,
  `js/polynomial-redos`, is fixed, not dismissed/suppressed. Post-merge CI `37664511798`
  passed all three required checks; CodeQL `37664511789` completed successfully. The PR #9 /
  failed-analysis checkpoint below is historical and no longer a blocker. Do not redo the fix.
- **Owner-reported GHCR review / cleanup:** before public exposure, the owner reviewed retained
  versions, removed pre-migration/private-history tagged artifacts and the stale pre-release
  `latest` tag, and retained seven canonical tagged versions plus sixteen untagged provenance/
  SBOM-related versions. These are the owner's pre-update inventory counts, not an independent
  API enumeration or a promise that publication of this update leaves the counts unchanged.
  Package visibility is now PUBLIC; the private-registry UAT path is not being pursued.
- **Pre-update artifact / publication:** GHCR `37664593471` succeeded for the pre-rewrite identity
  of the tree-equivalent baseline above, not for the replacement commit identity;
  its pre-rewrite immutable commit tag and then-current `edge` identified
  `ghcr.io/lvgvs/zimaos-mcp-server@sha256:bd67e42542a3fe82604a3d51419d2863d5bfbc084d6489633381c94b9471b2f3`.
  This is development content, not an approved stable release.
- **Anonymous access verified:** without GitHub credentials, pull-token and exact-digest manifest
  requests returned HTTP 200. The registry digest and independently computed manifest SHA-256
  matched. Docker pull with an isolated empty credential configuration succeeded, and image
  `RepoDigests` matched exactly. Existing base-layer cache was reused; authentication was clean,
  not the entire layer cache. Package-settings API access still lacks `read:packages`, but that
  does not block the independently verified intended anonymous distribution path.
- **Optional external scan:** OpenVuln/GLM was attempted only as an optional extra review.
  The manager reports its GitHub OAuth/sign-in flow is broken. No scan completed and no findings
  exist; it is neither a completed audit nor a release blocker.
- **Executed reconciliation gates:** format/diff checks, lint, production/test TypeScript checks,
  500/500 mocked tests across 28 files, production build, Docker build
  (`zimaos-mcp-server:phase4-status`) and Compose validation passed. No new live VM test or UI
  installation was performed. Only STATUS changes; runtime, tests and deployment remain unchanged.
- **This checkpoint / candidate selection:** only STATUS is reconciled; earlier engineering
  evidence and limitations remain below. After this PR's checks and Squash merge, verify clean
  synchronized `main`, exact-head CI/GHCR, and anonymous readback of the new main's immutable
  SHA tag/digest. Use that artifact for upcoming UAT; do not assume the pre-update `bd67...`
  digest is still the candidate. Record exact post-merge identifiers in the verified PR handoff
  rather than creating an endless chain of status-only publication commits.
- **Next real release gate:** fresh normal-user ZimaOS Custom App YAML installation and first
  start/health, performed by the manager/user with a digest-pinned image and mutation permissions
  off. No fresh UI UAT has started; developer live/container tests are not a substitute. Stop
  after this documentation PR and artifact verification, before starting UI UAT. No final
  version/tag/GitHub Release is approved or created; Phase 3 remains the feature cutoff.

## Historical Phase 4 bearer-parser CodeQL hardening — superseded PR review gate (2026-10-07 UTC)

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
  Compose validation passed. Staged-change and full reachable branch-history Gitleaks scans
  found zero leaks. No new live VM test.
- **PR checkpoint:** https://github.com/lvgvs/zimaos-mcp-server/pull/9 is OPEN and unmerged.
  Fix commit `af8ea7c9a757f253b8afaea60fb687191a69943e` passed all three required checks in
  CI `37641564270`. This documentation-only checkpoint preserves the same implementation/tests;
  verify fresh checks against the latest PR revision rather than inferring them from that run.
- **CodeQL blocker at fix commit:** default-setup run `37641555193` completed with failure before
  either analyzer executed; both check entries stayed queued, with no logs/annotations or PR
  analyses uploaded. The rerun API returned HTTP 500. Cause is unverified; repository Actions
  is enabled, allows all actions and does not require SHA pinning. Do not weaken settings or
  claim an empty analyses list proves zero findings. A fresh completed PR analysis is required.
- **Manager review gate:** verify all three required CI checks plus
  both CodeQL categories against the latest PR revision. Confirm alert #1 is
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

## Historical Phase 4 pre-UAT candidate — automated hardening / image-access gate (2026-10-07)

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

The seven recent author-email replacements preserve source trees. Their reachable equivalents
are used for source/baseline links; original workflow runs and image OCI revisions still identify
pre-rewrite executions/artifacts. This does not attribute old CI or UAT to a new SHA or image digest.

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
- **Phase 4:** release hardening and manager-run external runtime UAT are complete at the
  runtime-tested identity in the newest checkpoint. Phase 3 remains the feature cutoff;
  `v0.1.0` is the selected first stable release line, with publication governed by the release contract.
- **Phase 4 manager gates:** real-user UAT results must come from the manager/user; final release
  publication, final version/tag, source-repository visibility, and GHCR visibility changes require
  explicit manager approval. Do not begin a later phase automatically.
- **Publication evidence:** use the exact final checkpoint merge/artifact/checks from the
  release handoff, with live state in Git tags/GitHub Releases/GHCR; no publication-wording commit
  is needed. Fresh normal-user installation and all reported runtime UAT gates passed;
  that tested digest remains distinct from documentation-only release-source artifacts.

## Historical Phase 4 initial audit — then-blocked image-access gate (2026-10-01)

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

- **Release-source identity:** protected-main merge containing the final durable checkpoint;
  its exact SHA/digest is in the release handoff and Git/workflow records. The runtime-tested
  tree-equivalent source and unchanged tested digest remain separate above. Source publication
  state is not inferred from a working branch name or a historical baseline SHA.
- **Phase 2 final implementation HEAD:** `7dcb169d29df8b154c4658a689f5b9120db2e4f0`
- **Phase 3A HEAD:** `3102cdcd5533293c921c99c8f61e313daeed17b1`
- **Phase 3B HEAD:** `14b8f44180d1e4fb37fafca79c5d86e73fec25f4`
- **Phase 3C HEAD:** `60879a80d83659493e8256a765862c6e33cd5a4e`
- **Phase 3D HEAD:** `8467546bd137d9bdb6703f3d4dde3c181264be58`
- **Phase 3 final implementation HEAD:** `febdcf5c061edb9f21f80dc5115f30e51149de0b`
- **Repository URL:** https://github.com/lvgvs/zimaos-mcp-server
- **Repository visibility at Phase 4 authorization:** private.
- **GHCR:** PUBLIC after owner-reviewed retained-version cleanup; anonymous access verified.
  The newest checkpoint identifies the completed runtime-tested artifact, separately from
  docs-only post-merge publication. Historical Phase 3/older images are not current install targets.

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
