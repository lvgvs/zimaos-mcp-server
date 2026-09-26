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

Do not begin Phase 2.
