# ZimaOS MCP Server

## Product goal

Build a clean-room MCP server that allows MCP-capable AI agents to inspect and manage ZimaOS through supported ZimaOS APIs without granting those agents a root shell or direct Docker access.

Long-term architecture:

MCP client
→ ZimaOS MCP Server
→ safety / permission layer
→ official ZimaOS APIs
→ ZimaOS services

The project should eventually be suitable for public open-source release.

Initial development remains private until reviewed.

# Phase 1

## Objective

Deliver the smallest production-shaped vertical slice proving that:

1. an MCP client on another LAN host can connect to the service;
2. MCP network access is authenticated;
3. the service can authenticate to a current ZimaOS installation through supported APIs;
4. the service can inspect installed ZimaOS applications;
5. the service can perform basic reversible application controls;
6. application controls are disabled by default;
7. the service runs as a non-privileged Docker container;
8. a paste-ready deployment exists for ZimaOS's official Custom App Docker Compose/YAML import workflow;
9. the implementation lives in a private GitHub repository;
10. CI validates the project;
11. a GHCR container publishing workflow exists;
12. Phase 1 behavior is verified both with automated mocks and with the authorized disposable ZimaOS integration VM where applicable.

Phase 1 is intentionally narrow. Do not expand it into a general ZimaOS administration system.

# Phase 1 MCP tools

Implement the following tools.

Exact schemas may evolve during implementation if current official APIs require it, but semantic scope must remain equivalent.

## Read-only application tools

### `list_apps`

Return a concise normalized list of installed applications.

Useful fields where reliably available:

- stable application identifier;
- display name;
- state;
- health;
- installed/current version or image information.

Do not expose large raw upstream payloads.

### `get_app`

Return normalized information for one installed application.

Input should use a stable application identifier.

### `get_app_health`

Return available health/state information for the application and its services/containers.

Do not invent health data when ZimaOS does not expose it.

### `get_app_logs`

Return recent logs associated with an application.

Requirements:

- bounded output;
- reasonable default line/result limit;
- caller-selectable bounded limit where supported;
- no unbounded streaming in Phase 1.

Document that application-generated logs can themselves contain sensitive data outside this server's control.

### `list_app_containers`

Return normalized container/service information belonging to an installed app through supported ZimaOS APIs.

Do not mount the Docker socket.

## Read-only system tool

### `get_system_info`

Return a small normalized summary of the current ZimaOS system using supported current APIs.

Keep Phase 1 scope small.

Do not expand this into complete hardware, RAID, disk, or storage management.

## Reversible application controls

Implement:

- `start_app`
- `stop_app`
- `restart_app`

All must operate through supported ZimaOS application-management APIs.

They must be gated by:

`ALLOW_APP_CONTROL`

Default:

`false`

If disabled, control tools must return a clear permission error. Do not silently perform a successful no-op.

# Explicit Phase 1 exclusions

Do NOT implement as MCP product capabilities yet:

- application installation;
- application uninstall/removal;
- application update;
- App Store search;
- App Store registration;
- arbitrary Compose editing;
- arbitrary environment-variable editing;
- general Compose mutation;
- filesystem MCP tools;
- file deletion;
- host filesystem access;
- disk formatting;
- RAID modification;
- storage mutation;
- ZVM management;
- ZimaOS OTA installation;
- user management;
- SSH execution;
- arbitrary shell execution;
- Docker socket access;
- privileged mode;
- host-wide command execution.

The authorized integration-test VM may be configured with disposable test apps as needed to validate Phase 1. Test setup permission does not change this MCP feature scope.

# ZimaOS API integration

Research current supported APIs before coding against them.

Expected relevant domains include current ZimaOS application-management and system APIs, but the following must be verified rather than assumed:

- endpoint paths;
- API version;
- authentication flow;
- headers;
- payloads;
- response schemas;
- token/session behavior.

Create internal abstractions so MCP tools are not directly coupled to raw HTTP requests.

Expected conceptual components:

- ZimaOS authentication/session client;
- ZimaOS application client;
- ZimaOS system client;
- normalized domain models;
- permission layer;
- MCP tool layer;
- MCP transport layer.

ZimaOS authentication material must never be returned through MCP.

# MCP transport

Primary Phase 1 scenario:

Hermes or another MCP client runs on another LAN host/container and connects over the network.

Use the current supported MCP network transport appropriate for a remote server, preferring current Streamable HTTP behavior supported by the official MCP SDK.

Do not make Phase 1 stdio-only.

Expose:

- authenticated MCP endpoint;
- lightweight health/readiness endpoint.

Health/readiness must not leak secrets.

# MCP authentication

Remote MCP access must require authentication independent from ZimaOS credentials.

Use an explicit deployment secret such as:

`MCP_AUTH_TOKEN`

or a clearly documented equivalent if the chosen current SDK/API suggests a better mechanism.

Requirements:

- no default production token;
- fail startup or clearly reject MCP access when secure configuration is missing;
- never print the token;
- use appropriate constant-time/framework-provided credential comparison where relevant.

Phase 1 does not need multi-user identity or per-client ACLs.

# Configuration

Configuration must work naturally in Docker Compose.

Expected concepts:

- `ZIMAOS_URL`
- verified ZimaOS authentication configuration;
- `MCP_AUTH_TOKEN`
- `ALLOW_APP_CONTROL`
- `PORT`
- `LOG_LEVEL`

Exact variable names may be adjusted during implementation if documented.

Requirements:

- no hardcoded environment-specific ZimaOS address in production code;
- no committed real credentials;
- provide `.env.example`;
- validate configuration at startup;
- provide useful startup errors without printing secrets.

The local file `.env.integration.local` contains authorized disposable-VM credentials for developer-run live integration only. It must never be committed or copied into tracked configuration.

# Docker runtime

Create a production Dockerfile.

Requirements:

- supported Node.js runtime;
- multi-stage build where appropriate;
- minimal reasonable final image;
- production dependencies only in final runtime;
- non-root runtime user;
- no privileged mode;
- no Docker socket;
- no host filesystem mount;
- no persistent volume requirement unless research proves one is necessary;
- health check when appropriate.

The service must listen on a configurable container port.

# Reaching the ZimaOS API

The MCP container is intended to run as a ZimaOS Custom App.

Research the correct least-privileged method for the container to reach the ZimaOS API.

Do not assume `localhost` inside the container refers to the host.

Prefer ordinary container networking and an explicitly configured ZimaOS URL.

Avoid host networking unless authoritative research demonstrates it is actually necessary.

Document the chosen method and why it works.

# ZimaOS Custom App deployment

Create:

`deploy/zimaos/docker-compose.yml`

Target user flow:

1. open the ZimaOS application interface;
2. choose installation of a customized application;
3. choose Docker Compose/YAML import;
4. paste the provided YAML;
5. fill/review clearly marked configuration values;
6. install.

Use standard Compose plus current supported ZimaOS metadata only where useful.

Requirements:

- no real credentials in YAML;
- no baked registry credentials;
- no Docker socket;
- no privileged mode;
- no unnecessary host mounts;
- no dependency on development `/workspace`.

Document exactly what the installer must configure.

The authorized disposable integration VM may be used to validate this deployment flow. Browser automation may be used for this test if it is reliable and does not require exposing secrets in logs.

# GitHub repository

Canonical repository:

`zimaos-mcp-server`

Initial visibility:

PRIVATE

The repository is expected to become public later after manager review.

Do not change repository visibility automatically.

# Project license

Original project code:

Apache-2.0

Include an appropriate `LICENSE` file.

Verify licenses of important dependencies and official IceWhale packages used.

Record noteworthy license findings in documentation.

# GHCR

Create GitHub Actions capable of building and publishing the production image to GitHub Container Registry.

Expected image form:

`ghcr.io/<owner>/zimaos-mcp-server:<tag>`

Use GitHub-provided workflow credentials where supported.

Do not commit registry credentials.

During initial development:

- source repository remains private;
- GHCR package remains private unless explicitly approved otherwise.

Long-term installation goal:

- an approved release image can become anonymously pullable;
- ZimaOS paste installation then requires no registry credential.

Source repository visibility and GHCR package visibility are separate.

Do not add a permanent PAT requirement to the production Compose design.

# Version/tag strategy

Use a simple reproducible strategy.

At minimum support:

- immutable commit-SHA or equivalent CI image references;
- release/version tags when releases begin.

Do not treat `latest` as the only reproducible deployment reference.

A convenient development tag may exist in addition to immutable tags.

Document the chosen scheme.

# CI

Create GitHub Actions that at minimum verify:

- clean dependency installation;
- formatting/linting;
- TypeScript type checking;
- automated tests;
- production build;
- Docker image build.

Create a separate or appropriately gated workflow for GHCR publishing.

CI must not depend on the disposable integration VM.

# Testing

Automated mocked tests should cover at minimum:

- configuration validation;
- MCP authentication behavior;
- permission enforcement;
- ZimaOS authentication/session behavior through mocked HTTP;
- ZimaOS response normalization;
- MCP tool input validation;
- list/get application behavior;
- log bounding;
- application control behavior;
- upstream authentication failure;
- app-not-found mapping;
- upstream API unavailable/error mapping.

Live integration against the authorized disposable VM should verify, where supported by the current API:

- authentication/session behavior;
- `list_apps`;
- `get_app`;
- `get_app_health`;
- `get_app_logs`;
- `list_app_containers`;
- `get_system_info`;
- control tools denied when `ALLOW_APP_CONTROL=false`;
- start/stop/restart of a disposable test application when `ALLOW_APP_CONTROL=true`;
- recovery/health after restart;
- production Docker image startup;
- authenticated remote MCP connectivity;
- ZimaOS Custom App Compose/YAML deployment flow, if reliably automatable.

Live integration must use `.env.integration.local`.

Do not put integration credentials into CI.

If a disposable test application is needed, create/install one in the test VM without adding app-install functionality to the MCP product.

# Error model

Normalize common failures.

At minimum distinguish concepts equivalent to:

- invalid input;
- MCP authentication failure;
- ZimaOS authentication failure;
- app not found;
- operation disabled by permission;
- ZimaOS API unavailable;
- upstream ZimaOS API error;
- internal server error.

Do not make MCP clients interpret Axios/fetch implementation details.

Do not return ordinary raw stack traces.

# Output model

MCP tools should return compact structured information optimized for reliable agent use.

Prefer stable normalized objects over raw upstream API payloads.

An app result may conceptually contain:

- id;
- name;
- state;
- health;
- services;
- version/image information.

Only include fields actually supported by authoritative upstream data.

Do not invent unavailable values.

# Logging

Use structured or consistently formatted application logs.

Never log:

- ZimaOS passwords;
- ZimaOS authentication tokens;
- MCP bearer tokens;
- registry credentials.

Log sufficient operational information for debugging without exposing secrets.

Phase 1 does not require a persistent audit database.

# Repository deliverables

Phase 1 must include at least:

- `AGENTS.md`
- `PROJECT.md`
- `README.md`
- `LICENSE`
- `STATUS.md`
- `DECISIONS.md`
- `docs/RESEARCH.md`
- `.env.example`
- `.gitignore`
- TypeScript source
- automated tests
- production `Dockerfile`
- `deploy/zimaos/docker-compose.yml`
- GitHub Actions workflow(s)

README must explain:

- project purpose;
- Phase 1 capabilities;
- security model;
- configuration;
- normal Docker usage;
- ZimaOS Custom App YAML import;
- MCP client connection example;
- app-control permission;
- known limitations;
- private-image limitation during initial development.

# Phase 1 acceptance criteria

Phase 1 is complete when all safely achievable items below are satisfied:

- private GitHub repository exists;
- code is committed and pushed;
- Apache-2.0 `LICENSE` exists;
- current official ZimaOS APIs used are documented;
- supported ZimaOS authentication method is implemented;
- authenticated network MCP endpoint works in automated/local verification;
- health/readiness endpoint exists;
- `list_apps` implemented;
- `get_app` implemented;
- `get_app_health` implemented where supported by current API;
- `get_app_logs` implemented;
- `list_app_containers` implemented;
- `get_system_info` implemented;
- `start_app` implemented;
- `stop_app` implemented;
- `restart_app` implemented;
- application control defaults to disabled;
- no Docker socket is used;
- no SSH control plane is used;
- no privileged mode is used;
- no arbitrary shell tool exists;
- configuration validation exists;
- automated tests pass;
- formatter/linter passes;
- type checking passes;
- production build passes;
- Docker image build passes;
- CI exists and passes where GitHub execution is available;
- GHCR publishing workflow exists;
- ZimaOS paste-ready Compose YAML exists;
- README documents installation and security;
- live integration against the authorized disposable VM verifies the available Phase 1 API behavior;
- disposable-app start/stop/restart is live-tested when a suitable test app/API path is available;
- `STATUS.md` provides a clean manager handoff.

A live UI paste/install step that genuinely requires user interaction may remain as one explicit manual verification item after all automatable checks are complete.

Do not weaken security or expand scope to eliminate such a manual boundary.

Phase 1 is complete and manager-approved. Phase 2 is explicitly authorized under the specification below.

# Phase 2

## Objective

Add safe application provisioning and lifecycle management through supported ZimaOS APIs without
turning the MCP server into a general host-control or arbitrary-container-execution backdoor.

The primary end-to-end Phase 2 workflow is:

1. an authenticated MCP client supplies a Docker Compose YAML for a benign disposable app;
2. the server validates the Compose through supported ZimaOS behavior without persisting it;
3. the server evaluates the Compose for host-impacting/risky constructs;
4. when no elevated-risk construct is present and installation is permitted, the server installs
   the app through the supported ZimaOS API;
5. existing Phase 1 read tools verify that the installed app reaches the expected state;
6. where a supported removal API is verified, the server can remove the disposable app;
7. update behavior may be added only after its current supported API semantics are verified.

The MCP server itself remains a bootstrap dependency installed separately by the operator. Phase 2
does not require the product to install itself.

## Phase 2 MCP capabilities

Research and implement only the capabilities below where current supported ZimaOS APIs are
verified.

### validate_app_compose

Accept Docker Compose YAML and validate it without making a persistent application change.

Requirements:

- use the supported ZimaOS dry-run/validation mechanism where available;
- perform local structural/safety analysis before any mutating operation;
- return compact normalized validation findings;
- distinguish ordinary validation errors from elevated-risk findings;
- never silently modify or strip fields from the supplied Compose.

This operation is non-mutating and does not itself authorize installation.

### install_app_from_compose

Install an application from supplied Docker Compose YAML through a supported ZimaOS API.

Requirements:

- gated by a dedicated explicit install permission;
- default disabled;
- validate input and apply the Compose safety / informed-approval flow below before mutation;
- never treat an initial generic request to "install this" as informed approval of risks that were
  not yet disclosed;
- return normalized state/result information, not raw upstream payloads.

### uninstall_app

Implement only if a current supported ZimaOS removal API and its semantics are verified.

Requirements:

- use a stable app identifier;
- gated independently from install and basic start/stop/restart control;
- default disabled;
- verify post-removal state where practical.

### update_app

Implement only if a current supported ZimaOS update mechanism and its exact semantics are verified.

Requirements:

- gated independently;
- default disabled;
- do not invent update behavior from the presence of an update_available field alone;
- verify post-update state/version where practical.

A read-only update/status discovery tool may be added if current supported APIs expose useful
information that materially improves the update workflow.

## Permission model

Do not reuse ALLOW_APP_CONTROL as the sole gate for provisioning.

Keep the existing Phase 1 behavior unchanged and add separate default-off permissions for
materially different mutating operations. The expected configuration direction is conceptually:

- install permission;
- uninstall/removal permission;
- update permission.

Exact environment-variable names may be chosen during implementation, but they must be explicit,
documented, independently controllable, validated at startup, and default to false.

ALLOW_APP_CONTROL continues to govern only start_app, stop_app, and restart_app.

Do not introduce a permanent ALLOW_UNSAFE_COMPOSE (or equivalent) global bypass.

## Compose safety boundary

A Compose install can request capabilities that materially cross the product's normal security
boundary. Phase 2 must therefore inspect the supplied Compose before installation.

The safety analysis must conservatively detect host-impacting constructs where applicable,
including at minimum categories such as:

- privileged containers;
- Docker/container-runtime socket mounts;
- host PID or IPC namespace use;
- host networking;
- unrestricted or security-sensitive device passthrough;
- host filesystem bind mounts that expose sensitive host paths;
- other Compose options that materially grant host control or bypass the product's no-shell,
  no-Docker-socket, and no-direct-host-control design.

Do not assume this list is exhaustive. Research the Compose schema and implementation-visible
forms before finalizing the detector.

Risk analysis is a guardrail, not a claim that arbitrary Compose can be proven safe. Document that
limitation.

Normal application ports, named volumes, ordinary networks, and other non-host-privileged
constructs should remain usable where practical.

Never silently strip, rewrite, or downgrade a risky field. Either proceed unchanged after the
required informed approval or do not install.

## Risk disclosure and informed human approval

When an install request contains one or more elevated-risk Compose constructs:

1. Do not mutate ZimaOS on that first request.
2. Return a structured confirmation-required result containing:
   - the detected risk categories;
   - concise human-readable explanations;
   - the affected service/field/path where useful;
   - a confirmation/challenge identifier tied to the exact Compose content or an equivalent
     content fingerprint.
3. The MCP client/agent must present those newly discovered risks to the user and stop.
4. The user's original pre-disclosure request to install the app is not sufficient approval.
5. Installation may proceed only after the user explicitly approves after the risks have been
   disclosed.
6. Any approval must be bound to the exact Compose content that was reviewed. Changing the Compose
   invalidates the approval and requires fresh disclosure/approval.
7. Confirmation state should be single-purpose and short-lived where practical so an approval for
   one risky document cannot authorize another.

Prefer a current official MCP human-interaction / elicitation mechanism if the SDK and target
clients support one reliably. Research this before choosing the final confirmation mechanism.

If portable MCP transport cannot technically prove that a follow-up confirmation originated from a
human rather than an autonomous client, do not pretend otherwise. Implement the strongest
practical two-step confirmation contract, document its enforcement limits, and require manager
review of that design before Phase 2 acceptance.

If a client cannot complete the required post-disclosure confirmation flow, fail closed for the
risky install rather than treating the first request as consent.

There is no global unsafe mode that makes future risky Compose files install automatically.

## Research requirements

Research before implementing mutating Phase 2 behavior.

Follow the source priority in AGENTS.md and record verified findings in docs/RESEARCH.md.

At minimum verify:

- Compose dry-run/validation endpoint, request body, content type, and query parameters;
- port-conflict validation behavior;
- real install response and resulting application identifier/state;
- duplicate application/id behavior;
- invalid YAML/schema behavior;
- supported uninstall/removal endpoint, request shape, response, and side effects;
- supported update endpoint/mechanism, request shape, response, and version semantics;
- whether install/remove/update operations are synchronous or asynchronous;
- observable state transitions and appropriate polling behavior;
- missing-app and failed-operation error behavior;
- current MCP SDK/spec support for elicitation or another user-confirmation mechanism;
- any new YAML/Compose parsing dependency and its license.

Use the authorized disposable ZimaOS VM for secret-safe live probes when authoritative
documentation/specifications are incomplete or ambiguous.

Never print, log, commit, or copy ZimaOS credentials, bearer tokens, MCP tokens, or derived secret
material while probing.

Do not infer an endpoint merely because a similarly named endpoint exists in an older/community
implementation.

## Phase 2 testing

All Phase 1 behavior and tests must continue to pass.

Add mocked/automated tests covering at minimum:

- new configuration permissions and default-off behavior;
- Compose parsing and malformed input;
- benign Compose safety classification;
- each supported elevated-risk classification;
- no mutation on the first risky install request;
- content-bound confirmation invalidation when Compose content changes;
- install permission denied;
- install API success/error normalization;
- duplicate/port-conflict/invalid-Compose failures where supported;
- uninstall permission and behavior if implemented;
- update permission and behavior if implemented;
- regression coverage for existing Phase 1 tools and permissions.

Live Phase 2 acceptance must use a new benign disposable test application Compose, not the MCP
server's own deployment Compose.

Where supported, live integration should verify:

1. benign Compose validates through MCP without installation;
2. at least representative risky Compose fixtures are detected before mutation;
3. a risky first install request produces confirmation-required behavior and does not install;
4. the post-disclosure approval path is exercised safely if the chosen client/confirmation
   mechanism supports it;
5. install is denied when the install permission is false;
6. benign app installation succeeds when install permission is true;
7. the installed app appears through existing list_apps / get_app /
   list_app_containers / get_app_health tools and reaches a healthy/running state where
   applicable;
8. if uninstall is supported, removal is denied when its permission is false, then succeeds when
   enabled, and the app is verified absent;
9. if update is supported and a deterministic safe fixture exists, update permission and the
   resulting state/version are verified;
10. the disposable VM is left in a clean, known state.

Live integration must continue to use .env.integration.local and must not put VM credentials into
CI.

## Explicit Phase 2 exclusions

Unless separately authorized by a later manager decision, Phase 2 does not add:

- App Store search;
- App Store account/registration management;
- arbitrary editing of an already-installed app's Compose;
- arbitrary environment-variable mutation of existing apps;
- general-purpose Compose mutation tools;
- filesystem MCP tools;
- host filesystem browsing or deletion;
- SSH execution;
- arbitrary shell execution;
- Docker socket access as a product capability;
- privileged mode for the MCP server itself;
- host-wide command execution;
- disk formatting;
- RAID/storage mutation;
- ZVM management;
- ZimaOS OTA installation;
- user management.

If research shows App Store functionality is a separate product area, record it as a candidate for
a later Phase 2B or later phase rather than expanding Phase 2 automatically.

The fact that an explicitly approved third-party Compose may itself request elevated container
capabilities does not grant the MCP server a general shell/Docker/host-control tool.

## Phase 2 documentation and delivery

Update documentation to cover the implemented Phase 2 behavior, including:

- new tools;
- new permission flags and their default-off behavior;
- Compose safety analysis;
- informed approval semantics and limitations;
- install/uninstall/update behavior actually supported;
- any newly verified ZimaOS API behavior;
- examples that contain no real credentials or secret values.

Maintain the existing private repository and private GHCR package during Phase 2 unless the manager
explicitly approves a visibility change.

CI must continue to enforce all Phase 1 quality gates and all new automated tests.

## Phase 2 acceptance criteria

Phase 2 is complete only when all applicable items below are satisfied:

- Phase 1 functionality remains intact;
- validate_app_compose is implemented and tested;
- install_app_from_compose is implemented through a verified supported ZimaOS API;
- install permission is explicit and defaults to disabled;
- Compose safety analysis is implemented and tested;
- the first risky install attempt is non-mutating and returns structured risk disclosure;
- risky-install approval is bound to the reviewed Compose content and requires a post-disclosure
  confirmation step;
- the confirmation design and its human-enforcement limitations have been reviewed and documented;
- no global persistent unsafe-Compose bypass exists;
- uninstall is implemented and tested if a supported current API is verified, otherwise the
  unsupported/blocked reason is documented;
- update is implemented and tested if a supported current API is verified, otherwise the
  unsupported/blocked reason is documented;
- automated tests pass;
- formatting/linting passes;
- production and test TypeScript checks pass;
- production build passes;
- Docker image build passes;
- Compose deployment validation passes;
- CI passes;
- GHCR publishing remains functional;
- live validation/install behavior is exercised on the authorized disposable VM;
- a benign disposable app is verified through existing Phase 1 read/health tools after install;
- live risky-Compose detection demonstrates no first-request mutation;
- uninstall/update live tests are completed where supported and safely reproducible;
- the disposable VM is left in a clean/known state;
- README.md, docs/RESEARCH.md, DECISIONS.md, and STATUS.md accurately reflect the final implemented
  and verified behavior;
- STATUS.md provides a clean Phase 2 manager handoff.

Do not weaken the security model merely to make a Phase 2 acceptance item easier to satisfy.

Do not begin a later phase automatically.

Phase 2 is complete and manager-approved. Phase 3 is explicitly authorized under the specification below.

# Phase 3 — App Configuration & Repair

## Objective

Allow an authenticated MCP client to inspect, diagnose, validate, and safely change the Docker
Compose configuration of an already-installed ZimaOS application through verified supported ZimaOS
application-management APIs.

The purpose of Phase 3 is troubleshooting and repair: an agent should be able to use existing
read/log/health tools, inspect the application's current Compose configuration, propose a bounded
change, validate that exact proposed configuration, apply it safely when permitted, and verify the
result.

Phase 3 must remain inside the existing architecture:

MCP client
→ authenticated MCP server
→ permission / safety layer
→ typed ZimaOS API abstraction
→ supported ZimaOS APIs

Phase 3 does NOT grant the MCP server arbitrary host-file writes, SSH, shell execution, Docker
socket access, privileged mode, or direct mutation of undocumented ZimaOS internals.

## Phase 3 execution order

Phase 3 should be executed in the following sequence. A manager/orchestrator may receive the whole
Phase 3 assignment at once, but implementation work should still be decomposed into bounded,
reviewed tasks with durable checkpoints.

### Phase 3A — Supported API research and live semantics characterization

Before implementing Compose mutation, verify the exact current behavior of the supported ZimaOS
API on the authorized disposable VM.

At minimum determine and record:

- the supported endpoint/method for reading an installed app's Compose;
- whether the returned Compose is the exact stored/raw YAML or a transformed representation;
- the supported endpoint/method for applying a replacement Compose to an existing app;
- request content type, query/options, response envelope, and authentication behavior;
- synchronous vs asynchronous apply behavior;
- app-id/project-name invariants;
- behavior for malformed YAML;
- behavior for syntactically valid but invalid Compose;
- behavior for project/name mismatch;
- port-conflict behavior;
- missing-app behavior;
- 401/403/404/409/429/5xx behavior where safely reproducible;
- container recreation/restart behavior for representative env/port/image changes;
- concurrent/conflicting edit behavior;
- read-after-write visibility/lag;
- actual rollback/recovery behavior when apply fails.

Use current official ZimaSpace/IceWhaleTech sources first, then the authorized disposable VM to
resolve undocumented or ambiguous behavior. Record verified findings in docs/RESEARCH.md.

Do not implement a mutating edit tool until the endpoint and critical mutation/rollback semantics
needed by that tool are verified.

### Phase 3B — Read, fingerprint, diff, and validate

Add a read-only tool conceptually equivalent to:

- `get_app_compose`

It should return the current Compose representation needed for safe editing plus a stable content
fingerprint suitable for optimistic concurrency. Avoid leaking unrelated upstream payloads.

Add a non-mutating validation capability conceptually equivalent to:

- `validate_app_compose_change`

It should evaluate a proposed replacement Compose for a specific existing app without applying it.

The validation result should include, where meaningful:

- target app identity;
- expected/current base fingerprint;
- proposed-content fingerprint;
- structural/local validation result;
- upstream dry-run/validation result;
- port-conflict result;
- concise structured change summary;
- existing risk set;
- proposed risk set;
- risk delta, distinguishing newly introduced/escalated risk from unchanged or removed risk.

The exact original proposed UTF-8 Compose string is authoritative for validation, approval, and any
later mutation. Do not silently canonicalize/reserialize it into a different document.

### Phase 3C — Safe existing-app Compose edit

Add a dedicated permission:

`ALLOW_APP_EDIT`

Default:

`false`

Do not reuse `ALLOW_APP_CONTROL`, install permission, or uninstall permission as authority to edit
an existing application.

A safe edit must:

1. identify one existing app explicitly;
2. read the current Compose and establish a base fingerprint;
3. require the caller's expected base fingerprint for mutation;
4. reject the operation if the app changed since the caller read it;
5. require the proposed Compose to preserve the verified existing app/project identity;
6. run local parsing/safety analysis;
7. run supported upstream validation/dry-run and port-conflict checks where applicable;
8. evaluate risk delta;
9. use a per-app/process-local serialization mechanism sufficient for the verified single-process
   deployment model;
10. re-read/re-fingerprint immediately before mutation;
11. perform at most one real apply mutation for the accepted request;
12. never automatically retry an ambiguous/uncertain mutation outcome;
13. use bounded read-only reconciliation after asynchronous acceptance.

Optimistic concurrency is mandatory: an agent must not overwrite a newer ZimaOS/UI/user change
based on stale Compose state.

Do not expose a generic patch-language or filesystem-write capability merely for convenience. The
mutation boundary is a verified existing-app Compose API operation.

### Phase 3D — Risky edit informed approval

Reuse/generalize the approved Phase 2 modern risky-approval architecture for edits that introduce
or materially escalate host-impacting risk.

A risky edit's first request must not mutate.

Approval must be bound at minimum to:

- operation = existing-app Compose edit;
- target app identity;
- exact expected base/current fingerprint;
- exact proposed Compose content/fingerprint;
- disclosed risk delta;
- relevant options.

Changing the current app state or proposed Compose invalidates prior approval.

Preserve the existing properties:

- modern native MCP input-required / elicitation flow;
- signed short-lived request state;
- separate bounded process-wide pending/consumed ledger;
- single-use consumption;
- permission recheck;
- base-fingerprint/concurrency recheck;
- re-analysis and upstream validation before mutation;
- consume approval before the mutation boundary;
- at most one real apply mutation;
- no automatic mutation retry;
- risky legacy clients fail closed;
- no claim that MCP cryptographically proves human presence.

Existing risk should not automatically be presented as newly introduced risk. Risk disclosure for
an edit should focus on the delta while still preserving enough context to avoid hiding material
danger.

### Phase 3E — Recovery / rollback

Research and live-test ZimaOS's actual apply-failure rollback behavior before relying on it as a
product guarantee.

If a supported and sufficiently verified rollback/recovery operation exists, expose only the
smallest safe recovery capability justified by that evidence.

Do not claim that a backend `.bak` file or implementation detail guarantees successful recovery
without live verification.

Do not add arbitrary snapshot/file-copy/host-filesystem tools as a rollback substitute.

If reliable explicit rollback semantics cannot be verified, document that limitation and keep
recovery conservative rather than inventing rollback behavior.

## Phase 3 safety invariants

Phase 3 must preserve all earlier-phase guarantees unless an explicitly approved later decision
changes them.

In particular:

- all existing Phase 1 and Phase 2 tools and permission boundaries remain intact;
- app editing is independently default-off;
- exact source content is preserved across validation/approval/apply;
- stale-base edits fail closed;
- app identity/project name cannot silently change as part of an edit;
- newly introduced/escalated risky capabilities require post-disclosure approval;
- no global unsafe-edit bypass exists;
- no mutation is automatically retried after an ambiguous apply attempt;
- upstream free-form error text must not reflect Compose secrets back to MCP clients/logs;
- no SSH, arbitrary shell, Docker socket, privileged MCP-server container, or direct host-file
  mutation is introduced.

## Phase 3 testing

Maintain all Phase 1/2 regression coverage.

Add deterministic tests for at least:

- Compose read normalization and fingerprinting;
- exact-content preservation;
- same-base successful validation;
- stale-base conflict rejection;
- app/project identity mismatch;
- benign change validation;
- risk delta: unchanged risk, removed risk, and newly introduced/escalated risk;
- edit permission default-off;
- no mutation before risky-edit approval;
- approval binding to target/base/proposed content/risk delta;
- approval invalidation after current Compose changes;
- approval replay/single-use rejection;
- legacy risky-edit fail-closed behavior;
- at-most-one apply mutation;
- no automatic retry after timeout/ambiguous response;
- concurrency/race behavior for edits to the same app;
- unrelated/different-app behavior where concurrency design permits;
- bounded read-only post-apply reconciliation;
- rollback/recovery behavior only if it is actually implemented.

Live acceptance on the disposable VM should use a dedicated benign test app and, where safely
reproducible, exercise:

1. read current Compose;
2. validate without mutation;
3. benign env/config change;
4. benign port change;
5. representative image/config apply if useful;
6. stale-fingerprint rejection;
7. project/name mismatch rejection;
8. representative invalid YAML/Compose failure;
9. risky-edit first round without mutation;
10. post-apply read/health/log verification;
11. verified rollback/failure behavior if Phase 3E supports it;
12. cleanup/restoration to the known VM baseline.

Do not expose VM credentials or secret Compose values while testing.

## Explicit Phase 3 exclusions

Phase 3 does not automatically add:

- App Store search/account management;
- unverified App Store update semantics;
- arbitrary environment mutation outside the verified Compose edit path;
- arbitrary filesystem MCP tools;
- direct host filesystem browsing/writes/deletion;
- SSH;
- arbitrary shell execution;
- Docker socket access;
- privileged MCP-server mode;
- storage/RAID mutation;
- ZVM management;
- ZimaOS OTA/system update management;
- user/account management.

Those remain later-phase candidates unless separately approved.

## Phase 3 acceptance criteria

Phase 3 is complete only when all applicable items below are satisfied:

- Phase 3A exact read/apply/error/async semantics needed by the implementation are verified and
  recorded;
- current app Compose can be read safely through MCP;
- base fingerprint/optimistic concurrency is implemented and tested;
- proposed Compose changes can be validated without mutation;
- structured current/proposed risk delta is implemented;
- `ALLOW_APP_EDIT` is independent and defaults to false;
- safe existing-app Compose edit works through a verified supported ZimaOS API;
- app/project identity is preserved;
- stale-base edits fail closed;
- at most one real apply mutation occurs per accepted request;
- ambiguous mutation outcomes are never automatically retried;
- risky-edit first request is non-mutating;
- risky-edit approval is bound to target, base, exact proposed content, and disclosed risk delta;
- approval is expiring and single-use;
- risky legacy edit fails closed;
- post-apply state is reconciled read-only;
- rollback/recovery claims are limited to behavior actually verified in Phase 3E;
- all Phase 1/2 regressions remain passing;
- full automated quality gates pass;
- production Docker/Compose packaging remains valid;
- live benign read/validate/edit/reconcile behavior is verified on the disposable VM;
- disposable VM test state is restored/cleaned;
- documentation and durable state accurately describe implemented behavior and limitations.

Phase 3 is complete and manager-approved. Phase 4 is explicitly authorized under the specification below.

# Phase 4 — Release Hardening + First Release

## Objective

Phase 3 is the first-release **feature cutoff**. Phase 4 does not add a new capability family; it
turns the existing Phase 1–3 product into a release-ready package that a normal ZimaOS user can
install, configure, connect to, understand, troubleshoot, update between release candidates, and
remove/reinstall safely.

Phase 4 ends with the first tagged release only after explicit manager approval.

## Phase 4 scope

Phase 4 may:

- audit and fix release-blocking defects in existing Phase 1–3 behavior;
- harden the ZimaOS Custom App Docker Compose/YAML installation path;
- improve startup, health/readiness, configuration validation, authentication, and normalized errors;
- make required versus optional configuration clear and safe by default;
- harden MCP client connection/setup and tool-discovery documentation;
- verify existing read, control, provisioning, uninstall, Compose repair, and risky-approval flows;
- verify restart, ZimaOS reboot, uninstall/reinstall, and release-candidate upgrade behavior;
- improve CI, GHCR publishing, release automation, versioning metadata, changelog/release notes,
  dependency/license review, and secret/log review;
- add or improve tests and documentation needed for release confidence;
- make small UX/API-shape corrections when required to make an already-approved capability usable.

Keep fixes bounded. If an issue is a future enhancement rather than a first-release blocker, record
it for later instead of expanding Phase 4.

## Feature freeze / exclusions

Do not add substantial new product capabilities during Phase 4 merely for completeness.

In particular, Phase 4 does not automatically add:

- `update_app`; supported App Store update/version-transition semantics remain unverified;
- App Store search/account management;
- arbitrary filesystem tools or host-file mutation;
- SSH or arbitrary shell execution;
- Docker CLI/socket as a control plane;
- privileged MCP-server runtime;
- unsupported rollback/recovery;
- storage/RAID, ZVM, ZimaOS OTA, or user/account administration.

All runtime behavior must remain inside the existing supported official ZimaOS API boundary. If a
release blocker would require an undocumented/private endpoint, direct internal files/DB, shell,
Docker socket, privileged runtime, or another unsupported internal mechanism, stop for manager
review instead of implementing it.

## Real-user UAT

Real-user acceptance is mandatory in Phase 4 and is performed personally by the manager/user.

The execution manager should advance one coherent UAT gate at a time. At each gate it must give
short, exact normal-user instructions, stop, and wait for the user's reported result before
continuing.

UAT must use the intended supported user flow, such as the ZimaOS web UI, Custom App YAML import,
documented configuration, and an actual MCP client. Do not hide a release defect by asking the user
to rescue the system through SSH, Docker CLI, direct filesystem edits, hidden developer commands, or
undocumented APIs. If the documented normal-user path requires such a workaround, treat that as a
release defect or an explicitly documented limitation.

Expected UAT coverage includes, in bounded stages:

- fresh ZimaOS Custom App install and first start;
- health/readiness and required configuration;
- MCP client connection and `tools/list`;
- first read-only use;
- default-off permission behavior;
- existing start/stop/restart controls;
- install/uninstall flow;
- Compose read/validate/edit repair flow;
- risky-approval UX with a safe bounded scenario;
- wrong MCP token, wrong ZimaOS credentials, and unreachable/bad ZimaOS URL behavior;
- MCP server/container restart and ZimaOS reboot persistence;
- uninstall/reinstall;
- release-candidate upgrade;
- documentation-only fresh-user flow.

A failed UAT gate should lead to a bounded fix, automated regression, and repetition of only the
affected user flow before advancing.

## Local-model delegation during Phase 4

The parent/orchestration model should do routine Phase 4 work itself. A local coding worker is
optional, not required.

Use at most one bounded local worker only when a genuinely substantial, well-defined implementation
workload materially benefits from delegation, such as a significant deployment/release refactor or a
large mechanical test/refactor task. Small bug fixes, documentation, focused tests, simple workflow
edits, and routine UAT-driven corrections should remain parent-only.

The parent owns project decisions, review, tests, Git commits, and pushes. No nested delegation.

## Release and visibility approval gates

Do not change the source repository visibility or GHCR package visibility without explicit manager
approval.

Do not publish the final first-release tag or GitHub Release without explicit manager approval.
The execution manager may prepare and test release-candidate commits/images and propose a version,
but final version/tag publication is a manager gate.

## Phase 4 acceptance criteria

Phase 4 is complete only when all applicable items below are satisfied:

- the existing Phase 1–3 feature set remains intact and regression-tested;
- fresh normal-user ZimaOS Custom App installation succeeds through the documented YAML flow;
- required configuration, authentication, health/readiness, and MCP connection are understandable
  and verified;
- existing permission boundaries and default-off mutation controls are clear and behave correctly;
- representative read/control/provision/uninstall/repair/risky-approval user flows pass UAT;
- expected authentication/configuration/network failures produce useful non-secret behavior;
- restart and ZimaOS reboot behavior is verified;
- uninstall/reinstall is verified;
- a release-candidate upgrade path is verified;
- Quick Start, configuration reference, permissions, security model, risky approval, troubleshooting,
  limitations, upgrade, uninstall/reinstall, MCP examples, changelog/release notes, and release
  metadata are release-ready;
- dependency/license and secret/log reviews are complete;
- full automated tests, lint, formatting, TypeScript checks, production build, Docker build,
  deployment Compose validation, and repository diff checks pass;
- final candidate CI and GHCR workflows succeed;
- repository/GHCR visibility decisions are explicit;
- known limitations are documented;
- the manager explicitly approves the final version/tag/release;
- the first tagged release is published only after that approval.

Do not begin a later phase automatically.
