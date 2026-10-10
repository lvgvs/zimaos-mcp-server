/**
 * Typed ZimaOS API client.
 *
 * Wraps the three supported services:
 *   - user service    POST /v1/users/login            (auth)
 *   - app management  /v2/app_management/...         (compose apps, containers, logs, status)
 *   - zimaos core     /v2/zimaos/device/info          (system info)
 *
 * Envelope rules (see docs/RESEARCH.md):
 *   - user service + app management: { success, message, data } wrapper.
 *   - zimaos core (/v2/zimaos/*):    bare payload at top level.
 *
 * Security: the access token lives only in process memory on this object and is
 * never logged or returned to MCP clients (AGENTS.md).
 */

import { AppError, fromHttpStatus, isRecord } from "../errors.js";
import { assertStoreSelection, readInstalledStoreAssociation } from "./storeCatalog.js";
import type {
  StoreDetail,
  StoreSelection,
  InstalledStoreAssociation,
} from "./storeCatalog.js";

/** Bounded native read options for authenticated catalog GETs (Phase 6 slice). */
interface NativeReadOptions {
  /** "json" parses a bounded JSON envelope; "text" returns bounded raw UTF-8 text. */
  kind: "json" | "text";
  /** Hard byte bound for the whole streamed body. */
  limitBytes: number;
}

// Hard bounds so a hostile/verbose catalog payload cannot grow memory or MCP
// replies.
const MAX_STORE_JSON_BYTES = 4 * 1024 * 1024; // 4 MiB store listing/detail JSON
const MAX_STORE_YAML_BYTES = 512 * 1024; // 512 KiB store compose YAML

// Fixed, sanitized catalog read messages (no input/payload reflection).
const CATALOG_REDIRECTED = "The ZimaOS host redirected the catalog request.";
const CATALOG_TOO_LARGE = "The catalog response exceeds the allowed size.";
const CATALOG_BAD_ENCODING = "The catalog response has an invalid encoding.";
const CATALOG_EMPTY = "The catalog response is empty.";
const ARCHITECTURE_INVALID = "The app management info response is malformed.";
const COMPOSE_DETAIL_INVALID = "The store compose detail is invalid.";

export interface ZimaOsClientOptions {
  /** Base URL of the ZimaOS host, e.g. "http://192.0.2.5:8080". No trailing slash. */
  baseUrl: string;
  username: string;
  password: string;
  /** Injectable fetch for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

interface LoginEnvelope {
  success?: boolean;
  message?: string;
  data?: unknown;
}

/** Result of a health probe: "unhealthy"/"unknown" are data here, not errors. */
export interface HealthProbeResult {
  state: "healthy" | "unhealthy" | "unknown";
  /** Safe upstream detail (e.g. the app's own status string), if any. */
  detail?: string;
}

/**
 * Normalized result of a non-mutating Compose dry-run validation.
 *
 * This is data, not an error: a rejected document or an ambiguous upstream
 * failure are valid outcomes that callers must interpret, not exceptions.
 */
export interface ComposeValidationResult {
  /**
   * - "accepted": ZimaOS accepted the document in dry-run (HTTP 2xx). Nothing was
   *   installed; acceptance is not completion of any install.
   * - "rejected": ZimaOS definitively rejected it — an HTTP 4xx, or an HTTP 2xx envelope that
   *   reports success:false (e.g. malformed YAML, a schema-invalid Compose, or a host port conflict).
   * - "upstream_error": an ambiguous server-side failure (e.g. HTTP 502). This does
   *   NOT mean the document is invalid and does NOT mean the service is unavailable;
   *   it only means validation could not be confirmed.
   */
  status: "accepted" | "rejected" | "upstream_error";
  /** True only when ZimaOS accepted the document (HTTP 2xx). Never implies installation. */
  accepted: boolean;

  /** Host ports reported as already in use, when ZimaOS reports them (port conflict). */
  portsInUse?: number[];
}

/**
 * Normalized result of a single real Compose install attempt.
 *
 * This is data, not an error: an ambiguous upstream failure or a definitive
 * rejection are valid outcomes that callers must interpret, not exceptions.
 */
export interface ComposeInstallResult {
  /**
   * - "accepted": ZimaOS accepted the install request (2xx success:true or
   *   the verified message-only HTTP 200). The install is asynchronous:
   *   acceptance is NOT completion, and no app ID can be inferred from this
   *   response. Other 2xx bodies remain ambiguous -> "upstream_error".
   * - "rejected": ZimaOS definitively rejected it — an HTTP 4xx, or an HTTP 2xx
   *   envelope that reports success:false.
   * - "upstream_error": an ambiguous failure (HTTP 5xx/other status, empty body,
   *   non-JSON body). This does NOT mean the install failed and does NOT mean it
   *   succeeded; the outcome is unknown.
   */
  status: "accepted" | "rejected" | "upstream_error";
  /** True only on an explicit accepted envelope or verified async message. Never implies completion. */
  accepted: boolean;
}

/**
 * Normalized result of a single real Compose uninstall attempt.
 *
 * This is data, not an error: an ambiguous upstream failure or a definitive
 * rejection are valid outcomes that callers must interpret, not exceptions.
 */
export interface ComposeUninstallResult {
  /**
   * - "accepted": ZimaOS accepted the uninstall request (2xx success:true or
   *   the verified message-only HTTP 200). The removal is asynchronous:
   *   acceptance is NOT completion — the app may still be present for a while,
   *   and no further state can be inferred from this response. Other 2xx
   *   bodies remain ambiguous -> "upstream_error".
   * - "rejected": ZimaOS definitively rejected it — an HTTP 4xx (including the
   *   documented 404 for a missing app), or an HTTP 2xx envelope reporting success:false.
   * - "upstream_error": an ambiguous failure (HTTP 5xx/other status, empty body,
   *   non-JSON body). This does NOT mean the uninstall failed and does NOT mean it
   *   succeeded; the outcome is unknown.
   */
  status: "accepted" | "rejected" | "upstream_error";
  /** True only on an explicit accepted envelope or verified async message. Never implies completion. */
  accepted: boolean;
}

/**
 * Minimal typed client for the ZimaOS APIs used by this project.
 * Deliberately small: only operations required by Phase 1.
 */
export class ZimaOsClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private accessToken: string | null = null;
  private readinessProbe: Promise<boolean> | null = null;

  constructor(options: ZimaOsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.username = options.username;
    this.password = options.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // ------------------------------------------------------------------ auth --

  /**
   * Log in and cache the access token. Safe to call more than once; a fresh
   * login is performed each time (tokens are short-lived upstream).
   */
  async login(timeoutMs = this.timeoutMs): Promise<void> {
    const body = await this.rawRequest(
      "POST",
      "/v1/users/login",
      { username: this.username, password: this.password },
      false,
      undefined,
      undefined,
      timeoutMs,
    );

    if (!isRecord(body)) {
      throw new AppError("ZIMAOS_AUTH_FAILED", "Unexpected login response shape.");
    }
    const envelope = body as LoginEnvelope;
    if (envelope.success === false) {
      throw new AppError(
        "ZIMAOS_AUTH_FAILED",
        "ZimaOS rejected the configured credentials.",
      );
    }

    // data.token is an object: { access_token, refresh_token }. Defensively also
    // accept a plain string token in case of older/newer shapes.
    const data = envelope.data;
    let token: unknown = null;
    if (isRecord(data)) {
      const t = (data as Record<string, unknown>)["token"];
      if (typeof t === "string") token = t;
      else if (isRecord(t)) token = (t as Record<string, unknown>)["access_token"];
    } else if (typeof data === "string") {
      token = data;
    }

    if (typeof token !== "string" || token.length === 0) {
      throw new AppError(
        "ZIMAOS_AUTH_FAILED",
        "Login succeeded but no access token was returned.",
      );
    }
    this.accessToken = token;
  }

  /** Drop the cached token (e.g. after a 401). */
  invalidateSession(): void {
    this.accessToken = null;
  }

  /** True when an authenticated session is currently held. */
  hasSession(): boolean {
    return this.accessToken !== null;
  }

  // ------------------------------------------------------------- app mgmt --

  /** List installed compose apps: GET /v2/app_management/compose -> data map. */
  async listComposeApps(): Promise<unknown> {
    return await this.envelopeRequest("GET", "/v2/app_management/compose");
  }

  /** App detail: GET /v2/app_management/compose/{id} -> data object. */
  async getComposeApp(id: string): Promise<unknown> {
    return await this.envelopeRequest(
      "GET",
      `/v2/app_management/compose/${encodeURIComponent(id)}`,
    );
  }

  /** Read the official interpolated YAML representation (not raw stored source). */
  async getComposeAppYaml(id: string): Promise<string> {
    return this.readComposeProjection(id, (source) => source);
  }

  /** Internal identity-only read; unrelated interpolated secrets never leave transport. */
  async getComposeAppAssociation(id: string): Promise<InstalledStoreAssociation> {
    return this.readComposeProjection(id, readInstalledStoreAssociation);
  }

  private async readComposeProjection<T>(
    id: string,
    project: (source: string) => T,
  ): Promise<T> {
    if (this.accessToken === null) await this.login();
    try {
      return await this.readComposeYamlOnce(id, project);
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        this.invalidateSession();
        await this.login();
        return await this.readComposeYamlOnce(id, project);
      }
      throw err;
    }
  }

  private async readComposeYamlOnce<T>(
    id: string,
    project: (source: string) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v2/app_management/compose/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/yaml",
            Authorization: `Bearer ${this.accessToken}`,
          },
          signal: controller.signal,
          redirect: "error",
        },
      );
      // The returned YAML may contain interpolated secrets. Read within a hard
      // bound; neither error bodies nor the YAML are ever included in errors.
      const source = await this.readBoundedBody(
        response,
        { kind: "text", limitBytes: MAX_STORE_YAML_BYTES },
        controller.signal,
        this.timeoutMs,
      );
      if (source instanceof Error) throw source;
      if (typeof source !== "string")
        throw new AppError("ZIMAOS_UPSTREAM_ERROR", "Invalid Compose response.");
      const value = project(source);
      const exposed = typeof value === "string" ? value : JSON.stringify(value);
      if (
        exposed.includes(this.password) ||
        (this.accessToken !== null && exposed.includes(this.accessToken))
      ) {
        throw new AppError(
          "ZIMAOS_UPSTREAM_ERROR",
          "Compose contains ZimaOS credentials.",
        );
      }
      return value;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError("ZIMAOS_UNREACHABLE", "ZimaOS Compose read timed out.");
      }
      throw new AppError("ZIMAOS_UNREACHABLE", "Could not reach the ZimaOS host.");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Start/stop/restart: PUT /v2/app_management/compose/{id}/status.
   * The upstream body is a raw JSON string literal ("start" | "restart" | "stop").
   */
  async setComposeAppStatus(
    id: string,
    action: "start" | "restart" | "stop",
  ): Promise<void> {
    await this.envelopeRequest(
      "PUT",
      `/v2/app_management/compose/${encodeURIComponent(id)}/status`,
      JSON.stringify(action), // raw JSON string body
    );
  }

  /** Containers: GET /v2/app_management/compose/{id}/containers -> data object. */
  async getComposeAppContainers(id: string): Promise<unknown> {
    return await this.envelopeRequest(
      "GET",
      `/v2/app_management/compose/${encodeURIComponent(id)}/containers`,
    );
  }

  /**
   * Logs: GET /v2/app_management/compose/{id}/logs?lines=N -> data string.
   * `lines` is always bounded by the caller (see tools).
   */
  async getComposeAppLogs(id: string, lines: number): Promise<unknown> {
    return await this.envelopeRequest(
      "GET",
      `/v2/app_management/compose/${encodeURIComponent(id)}/logs?lines=${lines}`,
    );
  }

  /** Health check: GET /v2/app_management/compose/{id}/healthcheck -> data. */
  async healthCheckComposeApp(id: string): Promise<unknown> {
    return await this.envelopeRequest(
      "GET",
      `/v2/app_management/compose/${encodeURIComponent(id)}/healthcheck`,
    );
  }

  /**
   * Probe app health without treating an unhealthy/absent result as a failure.
   * Per docs/RESEARCH.md the endpoint returns BaseResponse: HTTP 200 means
   * healthy, 5xx means unhealthy, 404 means no usable health signal ("unknown").
   * Genuine transport/auth failures still throw AppError.
   */
  async probeComposeAppHealth(id: string): Promise<HealthProbeResult> {
    let body: unknown;
    try {
      // The health endpoint is a BaseResponse: HTTP status is the signal, not
      // an envelope success flag. Any resolved body (including empty) means
      // healthy; 404/5xx are data, not failures.
      body = await this.authedRequest(
        "GET",
        `/v2/app_management/compose/${encodeURIComponent(id)}/healthcheck`,
      );
    } catch (err) {
      if (err instanceof AppError) {
        switch (err.code) {
          case "ZIMAOS_NOT_FOUND":
            // No health endpoint / app not found: report honestly, don't invent.
            return { state: "unknown" };
          case "ZIMAOS_UPSTREAM_ERROR":
            // 5xx from the health endpoint itself: the app is down/unhealthy.
            return { state: "unhealthy" };
        }
      }
      throw err;
    }
    let detail: string | undefined;
    if (isRecord(body)) {
      const msg = body["message"];
      if (typeof msg === "string" && msg.length > 0) detail = msg;
    } else if (typeof body === "string") {
      detail = body;
    }
    return { state: "healthy", detail };
  }

  /**
   * Validate a Docker Compose document without installing it.
   *
   * Sends the exact original UTF-8 string as an `application/yaml` body to
   * POST /v2/app_management/compose?dry_run=true&check_port_conflict=true and
   * normalizes the outcome into {@link ComposeValidationResult}. The request is a
   * dry run: ZimaOS validates only and performs no installation.
   *
   * This method never throws for validation outcomes (accepted / rejected /
   * ambiguous upstream failure); those are returned as data. It still throws
   * AppError for genuine transport/auth failures, like every other client call.
   */
  async validateCompose(source: string): Promise<ComposeValidationResult> {
    return this.validateComposeAtPath("/v2/app_management/compose", "POST", source);
  }

  /** Native catalog preflight uses the verified explicit controlled option. */
  async validateNativeStoreCompose(source: string): Promise<ComposeValidationResult> {
    return this.validateComposeAtPath("/v2/app_management/compose", "POST", source, true);
  }

  /** Official existing-app PUT dry-run, with port checking and no mutation. */
  async validateComposeChange(
    id: string,
    source: string,
  ): Promise<ComposeValidationResult> {
    return this.validateComposeAtPath(
      `/v2/app_management/compose/${encodeURIComponent(id)}`,
      "PUT",
      source,
    );
  }

  private async validateComposeAtPath(
    path: string,
    method: "POST" | "PUT",
    source: string,
    controlled = false,
  ): Promise<ComposeValidationResult> {
    let outcome: DryRunOutcome;
    try {
      // The dry-run endpoint is a BaseResponse: the HTTP status is the signal.
      // 4xx (malformed YAML, schema-invalid Compose, port conflict) and 5xx are
      // data here, not failures — so read the raw response instead of letting
      // rawRequest throw on non-2xx.
      outcome = await this.composeDryRunOnce(source, path, method, controlled);
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        // Stale/expired token: retry once with a fresh login, mirroring authedRequest.
        this.invalidateSession();
        await this.login();
        outcome = await this.composeDryRunOnce(source, path, method, controlled);
      } else {
        throw err;
      }
    }

    return normalizeComposeValidation(outcome.status, outcome.body);
  }

  /**
   * Perform one real Compose install attempt and report its acceptance outcome.
   *
   * Sends exactly ONE POST with the exact original UTF-8 string as an
   * `application/yaml` body to
   * POST /v2/app_management/compose?dry_run=false&check_port_conflict=true, using
   * the existing bearer session (logging in once first only when no session is
   * held). The install POST is NON-IDEMPOTENT upstream: a duplicate creates a
   * second app. Therefore this method NEVER retries after the attempt has been
   * made — not on 401, timeout, network failure, or any other outcome — and it
   * never re-logs in to retry (a fresh login would only enable a duplicate POST).
   *
   * The response is an asynchronous acceptance signal, NOT completion: no app ID
   * can be inferred from it. Outcomes are normalized into
   * {@link ComposeInstallResult} and returned as data; upstream free-form text
   * (which may echo submitted YAML or secrets) is never relayed. Only genuine
   * transport/auth failures throw AppError, after the single attempt has been
   * made at most once.
   */
  async installComposeOnce(source: string): Promise<ComposeInstallResult> {
    return this.installComposeSourceOnce(source, false);
  }

  /** Same non-retrying install boundary, with fixed native controlled options. */
  async installNativeStoreComposeOnce(source: string): Promise<ComposeInstallResult> {
    return this.installComposeSourceOnce(source, true);
  }

  private async installComposeSourceOnce(
    source: string,
    controlled: boolean,
  ): Promise<ComposeInstallResult> {
    if (this.accessToken === null) {
      // No session yet: establish one first. This happens BEFORE any install
      // traffic, so a failed login never leaves an ambiguous attempt behind.
      await this.login();
    }

    let outcome: InstallOutcome;
    try {
      outcome = await this.installOnce(
        source,
        "/v2/app_management/compose",
        "POST",
        controlled,
      );
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        // The attempt was made and the session is stale. Drop it so later calls
        // re-authenticate, but do NOT retry: a second POST could create a
        // duplicate app. Surface the authentication failure instead.
        this.invalidateSession();
      }
      // Never retry after the mutation attempt (timeout/network/401/any other):
      // the install POST is non-idempotent upstream, so re-sending it — even with
      // a fresh login — could create a second app. Propagate as-is.
      throw err;
    }

    return normalizeComposeInstall(outcome.status, outcome.body);
  }

  /** One official existing-app PUT apply. Never retry after transmission. */
  async applyComposeChangeOnce(
    id: string,
    source: string,
  ): Promise<ComposeInstallResult> {
    if (this.accessToken === null) await this.login();
    let outcome: InstallOutcome;
    try {
      outcome = await this.installOnce(
        source,
        `/v2/app_management/compose/${encodeURIComponent(id)}`,
        "PUT",
      );
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        this.invalidateSession();
      }
      throw err;
    }
    // The observed v1.7.1 HTTP 200 message denotes async acceptance, not
    // completion. Never treat an unrelated message-only body as accepted.
    if (
      outcome.status === 200 &&
      isRecord(outcome.body) &&
      Object.keys(outcome.body).length === 1 &&
      outcome.body["message"] === "app is being applied with changes asynchronously"
    ) {
      return { status: "accepted", accepted: true };
    }
    return normalizeComposeInstall(outcome.status, outcome.body);
  }

  /**
   * Perform one real Compose uninstall attempt and report its acceptance outcome.
   *
   * Sends exactly ONE DELETE with no request body to
   * DELETE /v2/app_management/compose/{id}?delete_config_folder=false (the id is
   * URL-encoded), using the existing bearer session (logging in once first only
   * when no session is held). Explicit `delete_config_folder=false` overrides
   * the documented upstream default of true. Actual storage effects have not
   * been established; no more destructive option is exposed.
   *
   * The id must be a stable, explicitly provided, nonempty string; it is validated
   * before any network traffic (a blank/missing id throws INPUT_INVALID without
   * touching the host).
   *
   * The DELETE is NON-IDEMPOTENT in effect: re-sending it after an ambiguous
   * outcome could destroy a different app's state or race a still-running
   * removal. Therefore this method NEVER retries after the attempt has been made —
   * not on 401, timeout, network failure, or any other outcome — and it never
   * re-logs in to retry (a fresh login would only enable a duplicate DELETE).
   *
   * The response is an asynchronous acceptance signal, NOT completion: the app
   * may still be present for a while after acceptance. Outcomes are normalized
   * into {@link ComposeUninstallResult} and returned as data; upstream free-form
   * text (which may echo secrets) is never relayed. Only genuine transport/auth
   * failures throw AppError, after the single attempt has been made at most once.
   */
  async uninstallComposeOnce(id: string): Promise<ComposeUninstallResult> {
    if (typeof id !== "string" || id.trim().length === 0) {
      // Validate before any network traffic; never echo the input back.
      throw new AppError("INPUT_INVALID", "A nonempty application id is required.");
    }

    if (this.accessToken === null) {
      // No session yet: establish one first. This happens BEFORE any uninstall
      // traffic, so a failed login never leaves an ambiguous attempt behind.
      await this.login();
    }

    let outcome: UninstallOutcome;
    try {
      outcome = await this.uninstallOnce(id);
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        // The attempt was made and the session is stale. Drop it so later calls
        // re-authenticate, but do NOT retry: a second DELETE could race or repeat
        // a destructive removal. Surface the authentication failure instead.
        this.invalidateSession();
      }
      // Never retry after the mutation attempt (timeout/network/401/any other):
      // propagate as-is.
      throw err;
    }

    return normalizeComposeUninstall(outcome.status, outcome.body);
  }

  /**
   * Perform the single real-uninstall DELETE and report the HTTP status plus
   * parsed body. Non-2xx statuses are returned as data (never thrown) because
   * they carry the uninstall outcome; only transport/auth failures throw AppError.
   */
  private async uninstallOnce(id: string): Promise<UninstallOutcome> {
    const token = this.accessToken as string;

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      // Explicit non-destructive default; the id is URL-encoded. No request body.
      response = await this.fetchImpl(
        `${this.baseUrl}/v2/app_management/compose/${encodeURIComponent(id)}?delete_config_folder=false`,
        { method: "DELETE", headers, signal: controller.signal },
      );
      text = await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError(
          "ZIMAOS_UNREACHABLE",
          `Timed out after ${this.timeoutMs} ms while contacting ZimaOS.`,
        );
      }
      throw new AppError(
        "ZIMAOS_UNREACHABLE",
        "Could not reach the ZimaOS host (network error).",
      );
    } finally {
      clearTimeout(timer);
    }

    // 401/403/429 are auth/authorization/rate-limit failures, not uninstall outcomes.
    // Never retry the DELETE or relay upstream text on these responses.
    if (response.status === 429) {
      throw fromHttpStatus(429);
    }
    if (response.status === 401) {
      throw new AppError("ZIMAOS_AUTH_FAILED", "ZimaOS rejected the session token.");
    }
    if (response.status === 403) {
      throw fromHttpStatus(403); // PERMISSION_DENIED, safe fixed message.
    }

    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // A non-JSON body is still an outcome, not a crash: keep no structured data.
        body = null;
      }
    }
    return { status: response.status, body };
  }

  /**
   * Perform the single real-install POST and report the HTTP status plus parsed
   * body. Non-2xx statuses are returned as data (never thrown) because they
   * carry the install outcome; only transport/auth failures throw AppError.
   */
  private async installOnce(
    source: string,
    path = "/v2/app_management/compose",
    method: "POST" | "PUT" = "POST",
    controlled = false,
  ): Promise<InstallOutcome> {
    const token = this.accessToken as string;

    const BEARER = "Bearer";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `${BEARER} ${token}`,
      // The Compose document is YAML, not JSON.
      "Content-Type": "application/yaml",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}${path}?dry_run=false&check_port_conflict=true${controlled ? "&uncontrolled=false" : ""}`,
        // The exact original UTF-8 string is sent unchanged as the body.
        { method, headers, body: source, signal: controller.signal, redirect: "error" },
      );
      text = await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError(
          "ZIMAOS_UNREACHABLE",
          `Timed out after ${this.timeoutMs} ms while contacting ZimaOS.`,
        );
      }
      throw new AppError(
        "ZIMAOS_UNREACHABLE",
        "Could not reach the ZimaOS host (network error).",
      );
    } finally {
      clearTimeout(timer);
    }

    // 401/403/429 are auth/authorization/rate-limit failures, not install outcomes.
    // Never retry the POST or relay upstream text on these responses.
    if (response.status === 429) {
      throw fromHttpStatus(429);
    }
    if (response.status === 401) {
      throw new AppError("ZIMAOS_AUTH_FAILED", "ZimaOS rejected the session token.");
    }
    if (response.status === 403) {
      throw fromHttpStatus(403); // PERMISSION_DENIED, safe fixed message.
    }

    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // A non-JSON body is still an outcome, not a crash: keep no structured data.
        body = null;
      }
    }
    return { status: response.status, body };
  }

  /**
   * Perform one dry-run POST or PUT and report the HTTP status plus parsed body.
   * Non-2xx statuses are returned as data (never thrown) because they carry the
   * validation outcome; only transport/auth failures throw AppError.
   */
  private async composeDryRunOnce(
    source: string,
    path: string,
    method: "POST" | "PUT",
    controlled = false,
  ): Promise<DryRunOutcome> {
    if (this.accessToken === null) {
      await this.login();
    }
    const token = this.accessToken as string;

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      // The Compose document is YAML, not JSON.
      "Content-Type": "application/yaml",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}${path}?dry_run=true&check_port_conflict=true${controlled ? "&uncontrolled=false" : ""}`,
        // The exact original UTF-8 string is sent unchanged as the body.
        { method, headers, body: source, signal: controller.signal, redirect: "error" },
      );
      text = await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError(
          "ZIMAOS_UNREACHABLE",
          `Timed out after ${this.timeoutMs} ms while contacting ZimaOS.`,
        );
      }
      throw new AppError(
        "ZIMAOS_UNREACHABLE",
        "Could not reach the ZimaOS host (network error).",
      );
    } finally {
      clearTimeout(timer);
    }

    // 401/403 are auth/authorization failures, not validation outcomes: throw so the caller can
    // re-authenticate (401) or surface a permission error (403). They must never be normalized to
    // "rejected", and they never echo upstream text.
    if (response.status === 401) {
      throw new AppError("ZIMAOS_AUTH_FAILED", "ZimaOS rejected the session token.");
    }
    if (response.status === 403) {
      throw fromHttpStatus(403); // PERMISSION_DENIED, safe fixed message.
    }

    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // A non-JSON body is still an outcome, not a crash: keep no structured data.
        body = null;
      }
    }
    return { status: response.status, body };
  }

  // ------------------------------------------------------------- zimaos --

  /** Device info: GET /v2/zimaos/device/info -> bare payload (no envelope). */
  async getDeviceInfo(timeoutMs = this.timeoutMs): Promise<Record<string, unknown>> {
    const body = await this.authedRequest(
      "GET",
      "/v2/zimaos/device/info",
      undefined,
      timeoutMs,
    );
    if (!isRecord(body) || body["success"] === false) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Unexpected device info response shape or explicit upstream failure.",
      );
    }
    return body;
  }

  // ------------------------------------------------- catalog reads (GETs) --
  //
  // Bounded, authenticated, native catalog READ transport (Phase 6 slice).
  // These are read-only: the stale-401 retry exactly once is inherited from
  // authedRequest. No install/dry-run/mutation path is touched.

  /**
   * Store repository listing: GET /v3/app_store/repo.
   *
   * Returns the unwrapped `data` payload (bounded 4 MiB JSON envelope with
   * `success:false` rejected and sanitized).
   */
  async getStoreRepositories(): Promise<unknown> {
    const body = await this.envelopeRequest("GET", "/v3/app_store/repo", undefined, {
      kind: "json",
      limitBytes: MAX_STORE_JSON_BYTES,
    });
    return body;
  }

  /**
   * App management info: bare GET /v2/app_management/info (no envelope).
   *
   * Returns the top-level `architecture` field (must be "amd64" or "arm64");
   * any malformed payload fails closed with a sanitized upstream error.
   */
  async getAppManagementArchitecture(): Promise<string> {
    const body = await this.authedRequest(
      "GET",
      "/v2/app_management/info",
      undefined,
      this.timeoutMs,
      { kind: "json", limitBytes: MAX_STORE_JSON_BYTES },
    );
    if (!isRecord(body) || body["success"] === false) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", ARCHITECTURE_INVALID);
    }
    const architecture = body["architecture"];
    if (architecture !== "amd64" && architecture !== "arm64") {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", ARCHITECTURE_INVALID);
    }
    return architecture;
  }

  /**
   * Store app detail: GET
   * /v3/app_store/hub/repo/{encodeURIComponent(repoId)}/app/{encodeURIComponent(appId)}?locale=en_us
   *
   * The caller pair is validated with the shared `assertStoreSelection`
   * BEFORE any network traffic (path-injection characters are rejected).
   * Returns the unwrapped `data` payload (bounded 4 MiB JSON envelope).
   */
  async getStoreAppDetail(selection: StoreSelection): Promise<unknown> {
    assertStoreSelection(selection);
    const path =
      `/v3/app_store/hub/repo/${encodeURIComponent(selection.repoId)}` +
      `/app/${encodeURIComponent(selection.appId)}` +
      `?locale=en_us`;
    return this.envelopeRequest("GET", path, undefined, {
      kind: "json",
      limitBytes: MAX_STORE_JSON_BYTES,
    });
  }

  /**
   * Store compose document: GET
   * /v3/app_store/repo/proxy/{encodeURIComponent(repoId)}{composePath}
   *
   * `detail` is validated independently of any catalog source:
   *   - the pair passes the shared `assertStoreSelection`;
   *   - `architecture` is exactly "amd64" or "arm64";
   *   - `composePath` equals exactly `/apps/{appId}/docker-compose.{architecture}.yml`.
   *
   * No external URL is used: only the configured base URL plus the validated
   * registered repository identity and exact verified path.
   * Returns the YAML string byte-for-byte unchanged (bounded 512 KiB, strict
   * UTF-8; empty or undecodable bodies fail closed).
   */
  async getStoreCompose(detail: StoreDetail): Promise<string> {
    // A StoreDetail carries architecture/composePath beyond the caller pair, so
    // the shared assertStoreSelection (which rejects extra options) cannot be
    // applied to it directly: this client independently re-verifies every field
    // before building the path, fail-closed.
    if (!isRecord(detail)) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", COMPOSE_DETAIL_INVALID);
    }
    const repoId = detail["repoId"];
    const appId = detail["appId"];
    const architecture = detail["architecture"];
    const composePath = detail["composePath"];
    try {
      assertStoreSelection({ repoId, appId });
    } catch {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", COMPOSE_DETAIL_INVALID);
    }
    if (architecture !== "amd64" && architecture !== "arm64") {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", COMPOSE_DETAIL_INVALID);
    }
    const expected = `/apps/${appId}/docker-compose.${architecture}.yml`;
    if (composePath !== expected) {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", COMPOSE_DETAIL_INVALID);
    }
    const path = `/v3/app_store/repo/proxy/${encodeURIComponent(repoId)}${composePath}`;
    const text = await this.authedRequest("GET", path, undefined, this.timeoutMs, {
      kind: "text",
      limitBytes: MAX_STORE_YAML_BYTES,
    });
    if (typeof text !== "string") {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_EMPTY);
    }
    return text;
  }

  /** Active read-only readiness; at most four bounded I/O attempts, shared in flight. */
  checkReadiness(): Promise<boolean> {
    this.readinessProbe ??= this.getDeviceInfo(Math.min(this.timeoutMs, 1_000))
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        this.readinessProbe = null;
      });
    return this.readinessProbe;
  }

  // -------------------------------------------------------------- internals --

  private async authedRequest(
    method: string,
    path: string,
    rawBody?: string,
    timeoutMs = this.timeoutMs,
    readOptions?: NativeReadOptions,
  ): Promise<unknown> {
    if (this.accessToken === null) {
      await this.login(timeoutMs);
    }
    const token = this.accessToken as string;
    try {
      return await this.rawRequest(
        method,
        path,
        undefined,
        true,
        token,
        rawBody,
        timeoutMs,
        readOptions,
      );
    } catch (err) {
      // A stale/expired token: retry once with a fresh login.
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        this.invalidateSession();
        await this.login(timeoutMs);
        const fresh = this.accessToken as string;
        return await this.rawRequest(
          method,
          path,
          undefined,
          true,
          fresh,
          rawBody,
          timeoutMs,
          readOptions,
        );
      }
      throw err;
    }
  }

  /** Envelope-wrapped request: returns `data`, mapping failures to AppError. */
  private async envelopeRequest(
    method: string,
    path: string,
    rawBody?: string,
    readOptions?: NativeReadOptions,
  ): Promise<unknown> {
    const body = await this.authedRequest(
      method,
      path,
      rawBody,
      this.timeoutMs,
      readOptions,
    );
    if (!isRecord(body)) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Unexpected response shape from ZimaOS.",
      );
    }
    const envelope = body as LoginEnvelope;
    if (envelope.success === false) {
      // Free-form upstream messages may reflect submitted configuration/secrets.
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "ZimaOS reported the operation failed.",
      );
    }
    return envelope.data;
  }

  private async rawRequest(
    method: string,
    path: string,
    jsonBody?: unknown,
    authenticated = false,
    tokenOverride?: string,
    rawStringBody?: string,
    timeoutMs = this.timeoutMs,
    readOptions?: NativeReadOptions,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (authenticated) {
      const t = tokenOverride ?? this.accessToken;
      if (t === null || t === undefined) {
        throw new AppError("ZIMAOS_AUTH_FAILED", "No active session.");
      }
      headers["Authorization"] = `Bearer ${t}`;
    }

    let body: string | undefined;
    if (rawStringBody !== undefined) {
      body = rawStringBody;
      headers["Content-Type"] = "application/json";
    } else if (jsonBody !== undefined) {
      body = JSON.stringify(jsonBody);
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      // Native catalog GETs never follow redirects: a hop away from the
      // configured base is rejected, not chased (no caller URL is ever used).
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(readOptions !== undefined ? { redirect: "manual" } : {}),
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError(
          "ZIMAOS_UNREACHABLE",
          `Timed out after ${timeoutMs} ms while contacting ZimaOS.`,
        );
      }
      throw new AppError(
        "ZIMAOS_UNREACHABLE",
        "Could not reach the ZimaOS host (network error).",
      );
    }

    if (readOptions !== undefined) {
      // Timer covers the ENTIRE streamed body, not just the headers.
      try {
        const value = await this.readBoundedBody(
          response,
          readOptions,
          controller.signal,
          timeoutMs,
        );
        if (value instanceof Error) throw value;
        return value;
      } finally {
        clearTimeout(timer);
      }
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      clearTimeout(timer);
      throw this.transportError(err, timeoutMs);
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw fromHttpStatus(response.status);
    }

    // Some endpoints may return an empty body on 200.
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", "ZimaOS returned a non-JSON response.");
    }
  }

  /**
   * Read a native GET response within a hard byte bound, streaming it until
   * complete. The timer (set by the caller) covers the full body read.
   *
   * - redirects (status 3xx with redirect: "manual") are rejected, not followed;
   * - a numeric content-length above the bound is rejected before streaming;
   * - streamed bytes above the bound cancel the reader;
   * - JSON kind: strict UTF-8, JSON.parse, envelope success:false rejected;
   * - text kind: strict UTF-8, raw string returned unchanged.
   *
   * Returns the decoded value, or an Error to throw (never leaks payload bytes).
   */
  private async readBoundedBody(
    response: Response,
    options: NativeReadOptions,
    signal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const rejectBody = (error: AppError): AppError => {
      void response.body?.cancel().catch(() => undefined);
      return error;
    };
    if (signal?.aborted) {
      return rejectBody(
        new AppError(
          "ZIMAOS_UNREACHABLE",
          `Timed out after ${timeoutMs} ms while contacting ZimaOS.`,
        ),
      );
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      return rejectBody(new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_REDIRECTED));
    }
    if (!response.ok) {
      return rejectBody(fromHttpStatus(response.status));
    }

    // A numeric content-length above the bound is rejected up front (non-numeric
    // or absent values are still verified against streamed bytes).
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && /^\d+$/.test(contentLength)) {
      if (Number(contentLength) > options.limitBytes) {
        return rejectBody(new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_TOO_LARGE));
      }
    }

    const reader = response.body?.getReader();
    if (!reader) {
      // No body stream (e.g. empty 200): treat as an empty body.
      return options.kind === "text"
        ? new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_EMPTY)
        : null;
    }

    const whole = new Uint8Array(options.limitBytes);
    let bytes = 0;
    try {
      while (true) {
        // Race each read against the abort signal so a slow or hung stream
        // cannot outlive the timer: the timer bounds the FULL body read.
        const part = await this.readWithAbort(reader, signal);
        if (part.done) break;
        if (bytes + part.value.byteLength > options.limitBytes) {
          void reader.cancel().catch(() => undefined);
          return new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_TOO_LARGE);
        }
        whole.set(part.value, bytes);
        bytes += part.value.byteLength;
      }
    } catch (err) {
      // Abort (timeout) or a stream failure mid-read: sanitized transport error.
      void reader.cancel().catch(() => undefined);
      throw this.transportError(err, timeoutMs);
    } finally {
      reader.releaseLock();
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: options.kind === "text",
      }).decode(whole.subarray(0, bytes));
    } catch {
      return new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_BAD_ENCODING);
    }

    if (options.kind === "text") {
      if (text.length === 0) {
        return new AppError("ZIMAOS_UPSTREAM_ERROR", CATALOG_EMPTY);
      }
      // YAML returned byte-for-byte unchanged (strict UTF-8 already proven).
      return text;
    }

    if (text.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "ZimaOS returned a non-JSON response.",
      );
    }
    // A success:false envelope is an explicit upstream failure: sanitized.
    if (isRecord(parsed) && parsed["success"] === false) {
      return new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "ZimaOS reported the operation failed.",
      );
    }
    return parsed;
  }

  /** Race one streaming read against timeout, removing its listener on every outcome. */
  private async readWithAbort(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof reader.read>>> {
    if (!signal) return reader.read();
    let fail: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      fail = () => reject(new DOMException("Request timed out", "AbortError"));
      signal.addEventListener("abort", fail, { once: true });
      if (signal.aborted) fail();
    });
    try {
      return await Promise.race([reader.read(), aborted]);
    } finally {
      signal.removeEventListener("abort", fail);
    }
  }

  /** Map a fetch/stream failure to a sanitized AppError. */
  private transportError(err: unknown, timeoutMs?: number): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof Error && err.name === "AbortError") {
      const limit = timeoutMs ?? this.timeoutMs;
      return new AppError(
        "ZIMAOS_UNREACHABLE",
        `Timed out after ${limit} ms while contacting ZimaOS.`,
      );
    }
    return new AppError(
      "ZIMAOS_UNREACHABLE",
      "Could not reach the ZimaOS host (network error).",
    );
  }
}

/** One dry-run attempt: the HTTP status plus the parsed body (null when empty/non-JSON). */
interface DryRunOutcome {
  status: number;
  body: unknown;
}

/** One real-install attempt: the HTTP status plus the parsed body (null when empty/non-JSON). */
interface InstallOutcome {
  status: number;
  body: unknown;
}

/** One real-uninstall attempt: the HTTP status plus the parsed body (null when empty/non-JSON). */
interface UninstallOutcome {
  status: number;
  body: unknown;
}

// Bounding constants so a hostile/verbose upstream payload cannot grow an MCP reply.
const MAX_PORTS_IN_USE = 64;

/**
 * Normalize a dry-run outcome into {@link ComposeValidationResult}.
 *
 * The HTTP status is the primary signal (see docs/RESEARCH.md Phase 2 D), with one envelope override:
 *   - 2xx -> "accepted" (validation-only; nothing installed); but a 2xx envelope reporting success:false
 *     is a definitive negative -> "rejected".
 *   - 4xx -> "rejected" (ZimaOS definitively rejected: malformed YAML, schema-invalid, port conflict)
 *   - otherwise (5xx incl. 502, or any unexpected status) -> "upstream_error"
 *     (ambiguous: does NOT mean the document is invalid and does NOT mean the service is unavailable).
 *
 * Upstream free-form messages may echo any fragment of submitted YAML. Never relay them.
 * Only bounded numeric host ports are extracted from the response.
 */
function normalizeComposeValidation(
  status: number,
  body: unknown,
): ComposeValidationResult {
  const isRecordBody = isRecord(body);
  // A 2xx envelope can still report success:false (ZimaOS processed the request and answered
  // "no"). That is a definitive negative, not acceptance.
  const successFalse = isRecordBody && body["success"] === false;

  let resultStatus: ComposeValidationResult["status"];
  if (status >= 200 && status < 300) {
    resultStatus = successFalse ? "rejected" : "accepted";
  } else if (status >= 400 && status < 500) {
    resultStatus = "rejected";
  } else {
    // 5xx (incl. the observed empty 502) and any other unexpected status: ambiguous, not a verdict.
    resultStatus = "upstream_error";
  }

  const accepted = resultStatus === "accepted";
  let portsInUse: number[] | undefined;

  if (isRecordBody) {
    portsInUse = extractPortsInUse(body["data"]);
  }

  return { status: resultStatus, accepted, portsInUse };
}

/** Defensively read `data.ports_in_use` as a bounded list of valid host port numbers. */
function extractPortsInUse(data: unknown): number[] | undefined {
  if (!isRecord(data)) return undefined;
  const raw = data["ports_in_use"];
  if (!Array.isArray(raw)) return undefined;

  const ports: number[] = [];
  for (const entry of raw) {
    let n: number | null = null;
    if (typeof entry === "number" && Number.isInteger(entry)) {
      n = entry;
    } else if (typeof entry === "string" && /^\d+$/.test(entry.trim())) {
      // Ports may be reported as numeric strings; accept pure digits only.
      n = Number.parseInt(entry, 10);
    }
    if (n !== null && n > 0 && n <= 65535) {
      ports.push(n);
    }
    if (ports.length >= MAX_PORTS_IN_USE) break; // bound the list size.
  }
  return ports.length > 0 ? ports : undefined;
}

/** Live v1.7.1 returns a message-only 200 for these asynchronous operations. */
function hasAsyncAcceptanceMessage(
  body: Record<string, unknown>,
  operation: "installed" | "uninstalled",
): boolean {
  return (
    Object.keys(body).length === 1 &&
    typeof body["message"] === "string" &&
    body["message"].toLowerCase() === `app is being ${operation} asynchronously`
  );
}

/**
 * Normalize a real-install outcome into {@link ComposeInstallResult}.
 *
 * The install is asynchronous: an accepted response only means ZimaOS took the
 * request — it is NOT completion, and no app ID can be inferred from it.
 *
 *   - 2xx with success:true or the verified message-only HTTP 200 -> "accepted".
 *     A 2xx success:false is a definitive rejection. Other 2xx bodies give no
 *     confirmation of acceptance ->
 *     "upstream_error" (ambiguous; does NOT mean the install failed and does NOT
 *     mean it succeeded).
 *   - 4xx -> "rejected" (ZimaOS definitively rejected the install).
 *   - otherwise (5xx incl. an empty 502, any other status, or a missing/empty/
 *     non-JSON body) -> "upstream_error": ambiguous; does NOT mean the install
 *     failed and does NOT mean it succeeded.
 *
 * Upstream free-form messages may echo submitted YAML (including secrets). They
 * are never relayed: only this fixed-shape result is returned.
 */
function normalizeComposeInstall(status: number, body: unknown): ComposeInstallResult {
  let statusOut: ComposeInstallResult["status"] = "upstream_error";
  if (status >= 200 && status < 300 && isRecord(body)) {
    if (body["success"] === true) statusOut = "accepted";
    else if (body["success"] === false) statusOut = "rejected";
    else if (status === 200 && hasAsyncAcceptanceMessage(body, "installed")) {
      statusOut = "accepted";
    }
  } else if (status >= 400 && status < 500) {
    statusOut = "rejected";
  }
  return { status: statusOut, accepted: statusOut === "accepted" };
}

/**
 * Normalize a real-uninstall outcome into {@link ComposeUninstallResult}.
 *
 * The uninstall is asynchronous: an accepted response only means ZimaOS took the
 * request — it is NOT completion; the app may still be present for a while.
 *
 *   - 2xx with success:true or the verified message-only HTTP 200 -> "accepted".
 *     A 2xx success:false is a definitive rejection. Other 2xx bodies give no
 *     confirmation of acceptance ->
 *     "upstream_error" (ambiguous; does NOT mean the uninstall failed and does
 *     NOT mean it succeeded).
 *   - 4xx -> "rejected" (ZimaOS definitively rejected: e.g. the documented 404
 *     for a missing app, or any other client-side rejection).
 *   - otherwise (5xx incl. an empty 502, any other status) -> "upstream_error":
 *     ambiguous; does NOT mean the uninstall failed and does NOT mean it succeeded.
 *
 * Upstream free-form messages may echo secrets. They are never relayed: only
 * this fixed-shape result is returned.
 */
function normalizeComposeUninstall(
  status: number,
  body: unknown,
): ComposeUninstallResult {
  let statusOut: ComposeUninstallResult["status"] = "upstream_error";
  if (status >= 200 && status < 300 && isRecord(body)) {
    if (body["success"] === true) statusOut = "accepted";
    else if (body["success"] === false) statusOut = "rejected";
    else if (status === 200 && hasAsyncAcceptanceMessage(body, "uninstalled")) {
      statusOut = "accepted";
    }
  } else if (status >= 400 && status < 500) {
    statusOut = "rejected";
  }
  return { status: statusOut, accepted: statusOut === "accepted" };
}
