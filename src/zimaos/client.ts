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
  async login(): Promise<void> {
    const body = await this.rawRequest(
      "POST",
      "/v1/users/login",
      { username: this.username, password: this.password },
      false,
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
    let outcome: DryRunOutcome;
    try {
      // The dry-run endpoint is a BaseResponse: the HTTP status is the signal.
      // 4xx (malformed YAML, schema-invalid Compose, port conflict) and 5xx are
      // data here, not failures — so read the raw response instead of letting
      // rawRequest throw on non-2xx.
      outcome = await this.composeDryRunOnce(source);
    } catch (err) {
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        // Stale/expired token: retry once with a fresh login, mirroring authedRequest.
        this.invalidateSession();
        await this.login();
        outcome = await this.composeDryRunOnce(source);
      } else {
        throw err;
      }
    }

    return normalizeComposeValidation(outcome.status, outcome.body);
  }

  /**
   * Perform one dry-run POST and report the HTTP status plus parsed body.
   * Non-2xx statuses are returned as data (never thrown) because they carry the
   * validation outcome; only transport/auth failures throw AppError.
   */
  private async composeDryRunOnce(source: string): Promise<DryRunOutcome> {
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
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/v2/app_management/compose?dry_run=true&check_port_conflict=true`,
        // The exact original UTF-8 string is sent unchanged as the body.
        { method: "POST", headers, body: source, signal: controller.signal },
      );
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

    const text = await response.text();
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
  async getDeviceInfo(): Promise<Record<string, unknown>> {
    const body = await this.authedRequest("GET", "/v2/zimaos/device/info");
    if (!isRecord(body)) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Unexpected device info response shape.",
      );
    }
    return body;
  }

  // -------------------------------------------------------------- internals --

  private async authedRequest(
    method: string,
    path: string,
    rawBody?: string,
  ): Promise<unknown> {
    if (this.accessToken === null) {
      await this.login();
    }
    const token = this.accessToken as string;
    try {
      return await this.rawRequest(method, path, undefined, true, token, rawBody);
    } catch (err) {
      // A stale/expired token: retry once with a fresh login.
      if (err instanceof AppError && err.code === "ZIMAOS_AUTH_FAILED") {
        this.invalidateSession();
        await this.login();
        const fresh = this.accessToken as string;
        return await this.rawRequest(method, path, undefined, true, fresh, rawBody);
      }
      throw err;
    }
  }

  /** Envelope-wrapped request: returns `data`, mapping failures to AppError. */
  private async envelopeRequest(
    method: string,
    path: string,
    rawBody?: string,
  ): Promise<unknown> {
    const body = await this.authedRequest(method, path, rawBody);
    if (!isRecord(body)) {
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        "Unexpected response shape from ZimaOS.",
      );
    }
    const envelope = body as LoginEnvelope;
    if (envelope.success === false) {
      // `message` is upstream-provided and safe to surface.
      throw new AppError(
        "ZIMAOS_UPSTREAM_ERROR",
        typeof envelope.message === "string" && envelope.message.length > 0
          ? envelope.message
          : "ZimaOS reported the operation failed.",
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
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

    const text = await response.text();
    if (!response.ok) {
      throw fromHttpStatus(response.status, extractDetail(text));
    }

    // Some endpoints may return an empty body on 200.
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("ZIMAOS_UPSTREAM_ERROR", "ZimaOS returned a non-JSON response.");
    }
  }
}

/** Pull a short, safe detail string out of an upstream error body if present. */
function extractDetail(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      const msg = parsed["message"];
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  } catch {
    // not JSON — ignore
  }
  return undefined;
}

/** One dry-run attempt: the HTTP status plus the parsed body (null when empty/non-JSON). */
interface DryRunOutcome {
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
