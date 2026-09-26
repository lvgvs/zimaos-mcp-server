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
