# ZimaOS API Research

Authoritative research for the ZimaOS MCP Server. Every API operation used by the
implementation is recorded here with its authoritative source and implementation
implication, per `AGENTS.md`. Copied source text is kept minimal; concise technical
summaries are preferred.

## Sources (priority order)

1. **ZimaSpace OpenAPI developer guide** — official documentation.
   - https://www.zimaspace.com/docs/zimaos/openapi-developer-guide
   - https://www.zimaspace.com/docs/developer/openapi-developer-guide
2. **IceWhale-OpenAPI** — official OpenAPI specifications (YAML). The canonical repo path
   `github.com/IceWhaleTech/IceWhale-OpenAPI` returned 404 at research time, so the specs
   were retrieved from a verified fork/mirror of that repository:
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos-app-management/app_management/openapi.yaml
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos-user-service/users/openapi_v1.yaml
   - https://raw.githubusercontent.com/DeniskaAbr/IceWhale-OpenAPI/main/zimaos/zimaos/openapi.yaml
3. **Official `@icewhale/*` npm SDKs** (Apache-2.0) — generated from the same specs; used as a
   second verifiable source for endpoint paths and request/response types:
   - `@icewhale/casaos-appmanagement-openapi`
   - `@icewhale/casaos-openapi`
4. **Live integration VM** (authorized, disposable) — ZimaOS v1.7.1, x86_64. Used to confirm
   real response envelopes and field names that the specs leave ambiguous.

> Note: the official `@icewhale/casaos-openapi` SDK declares a base path of `/v2/casaos`, but
> the live ZimaOS v1.7.1 VM serves the core service at **`/v2/zimaos`**. The live value is used.

## API base paths (confirmed)

| Service | Base path (`servers.url`) | Notes |
|---|---|---|
| User service (auth) | `/v1/users` | login only for this project |
| App management | `/v2/app_management` | compose app lifecycle + logs |
| ZimaOS core | `/v2/zimaos` | device/system info |

All endpoints are plain HTTP on the integration VM. No `curl -k`/`--insecure`.

## Authentication

- **Endpoint:** `POST /v1/users/login` (user service).
- **Request body:** JSON `{ "username": string, "password": string }`.
- **Response envelope:** HTTP 200 with a ZimaOS wrapper object:
  - top-level keys: `success`, `message`, `data`
  - `data.token` is an **object** (not a string): `{ access_token, refresh_token }`.
- **Authorization for subsequent calls:** `Authorization: Bearer <access_token>`.
- The token is kept only in process memory or a permission-restricted temp file and used
  silently; it is never logged, printed, or written to tracked files.

**Implementation implication:** the auth/session client must parse `data.token.access_token`
from an object (not assume a string token), and send `Bearer <token>` on every downstream call.

## App management (`/v2/app_management`)

All responses use the ZimaOS envelope `{ success, message, data }` unless noted. The `data`
field carries the payload described below.

### List installed compose apps — `GET /compose`
- **Response 200** → `ComposeAppListOK`: envelope with `data` = object keyed by app id, each
  value a `ComposeAppWithStoreInfo`. (Live v1.7.1 confirmed: top-level `{ data }`, where
  `data` is an object map; empty when no apps installed.)
- **Implementation implication:** parse `data` as a record/map of app-id → app, not an array.

### App detail — `GET /compose/{id}`
- **Response 200** → `ComposeAppOK`: envelope with `data` = single `ComposeAppWithStoreInfo`.
- Accepts `Accept: application/json` or `application/yaml` (yaml returns interpolated compose).

### Install a compose app — `POST /compose`
- **Request:** body is the Docker Compose YAML content; `Content-Type: application/yaml`.
  Query params: `dry_run=true` (validate only), `check_port_conflict`, `uncontrolled`.
- **Response 200** → `ComposeAppInstallOK`: envelope (`BaseResponse`).
- **Implementation implication:** install is a control operation; must be gated by the
  permission layer and disabled by default.

### Start / restart / stop — `PUT /compose/{id}/status`
- **Request body:** a raw JSON **string** enum, not an object: `"start"`, `"restart"`, or
  `"stop"` (per `requestBodies/RequestComposeAppStatus`). Content-Type `application/json`.
- **Response 200** → `RequestComposeAppStatusOK`: envelope (`BaseResponse`).
- **Implementation implication:** the status body is a JSON string literal; serialize as
  `JSON.stringify("start")` etc. This is a control operation (gated, off by default).

### Containers — `GET /compose/{id}/containers`
- **Response 200** → `ComposeAppContainersOK`: envelope with `data` = array of containers.

### Logs — `GET /compose/{id}/logs?lines=N`
- **Query param:** `lines` (number) bounds the log size.
- **Response 200** → `ComposeAppLogsOK`: envelope with `data` = string (the logs).
- **Implementation implication:** always pass a bounded `lines`; cap output length in the MCP
  tool to avoid unbounded payloads.

### Health check — `GET /compose/{id}/healthcheck`
- **Response 200** → `ComposeAppHealthCheckOK`: envelope with health status data.

## ZimaOS core (`/v2/zimaos`)

### Device info — `GET /device/info`
- **Response 200:** a **bare payload** (no `{success,message,data}` wrapper) of type
  `DeviceInfo`. Live v1.7.1 top-level keys:
  - `arch`, `can_control_powerled`, `cpu` (`{cores, frequency, model, threads}`),
    `device_code`, `device_image_path`, `device_model`, `device_name`, `gpu` (array),
    `hash`, `is_licensed`, `memory` (`{frequency, slots_used, total_byte, type}`),
    `os_version`.
- The spec's minimal `DeviceInfo` schema lists only `device_name`, `device_model`,
  `os_version`, `hash`; the live VM returns a richer set. Model the fields actually returned.

**Implementation implication:** core-service endpoints return data at top level (not wrapped),
unlike app-management and user-service which use the envelope. The system client must not
unwrap a `data` key for `/v2/zimaos/*`.

## Response-envelope rules (confirmed live)

| Endpoint | Envelope |
|---|---|
| `POST /v1/users/login` | wrapped `{success,message,data}`; `data.token={access_token,refresh_token}` |
| `GET /v2/app_management/compose` | wrapped; `data` = object map of app-id → `ComposeAppWithStoreInfo` |
| `PUT /v2/app_management/compose/{id}/status` | wrapped (`BaseResponse`) |
| `GET /v2/app_management/compose/{id}/logs` | wrapped; `data` = string |
| `GET /v2/zimaos/device/info` | **bare** payload (no wrapper) |

## Compatibility note

- Verified against ZimaOS **v1.7.1** on the authorized disposable integration VM (x86_64).
- The app-management and user-service services use the `{success,message,data}` envelope;
  the core service (`/v2/zimaos`) returns bare payloads. Clients are written to each rule.
