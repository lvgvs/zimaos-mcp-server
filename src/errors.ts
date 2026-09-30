/**
 * Normalized error model.
 *
 * Upstream ZimaOS failures are mapped to a small set of stable codes so MCP
 * clients can rely on them without parsing raw upstream payloads or stack
 * traces (AGENTS.md: normalize upstream errors, never return ordinary internal
 * stack traces).
 */

export type ErrorCode =
  | "CONFIG_INVALID"
  | "AUTH_REQUIRED" // missing/invalid MCP bearer token
  | "ZIMAOS_UNREACHABLE"
  | "ZIMAOS_AUTH_FAILED"
  | "ZIMAOS_NOT_FOUND"
  | "ZIMAOS_BAD_REQUEST"
  | "ZIMAOS_RATE_LIMITED"
  | "ZIMAOS_UPSTREAM_ERROR"
  | "PERMISSION_DENIED"
  | "APP_CONTROL_DISABLED"
  | "APP_INSTALL_DISABLED"
  | "APP_UNINSTALL_DISABLED"
  | "INPUT_INVALID"
  | "INTERNAL";

export interface AppErrorInfo {
  code: ErrorCode;
  /** Human-readable, safe to show to an MCP client. */
  message: string;
}

/** Error carrying a normalized code + safe message. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** Map an upstream HTTP status to a normalized error. */
export function fromHttpStatus(status: number, detail?: string): AppError {
  switch (status) {
    case 401:
      return new AppError(
        "ZIMAOS_AUTH_FAILED",
        "ZimaOS rejected the configured credentials.",
      );
    case 403:
      return new AppError(
        "PERMISSION_DENIED",
        detail ?? "The ZimaOS account does not have permission for this operation.",
      );
    case 404:
      return new AppError(
        "ZIMAOS_NOT_FOUND",
        "The requested resource was not found on the ZimaOS host.",
      );
    case 429:
      return new AppError(
        "ZIMAOS_RATE_LIMITED",
        "The ZimaOS host is rate-limiting requests; retry shortly.",
      );
    default:
      if (status >= 500) {
        return new AppError(
          "ZIMAOS_UPSTREAM_ERROR",
          `ZimaOS returned an unexpected server error (${status}).`,
        );
      }
      return new AppError(
        "ZIMAOS_BAD_REQUEST",
        detail ?? `ZimaOS rejected the request (HTTP ${status}).`,
      );
  }
}

/** True when a value is a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
