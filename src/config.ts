/**
 * Startup configuration.
 *
 * All values come from environment variables so the service works naturally in
 * Docker Compose. No environment-specific ZimaOS address is hardcoded anywhere.
 */

export interface AppConfig {
  /** Base URL of the ZimaOS instance, e.g. http://192.0.2.28 (no trailing slash). */
  zimaosUrl: string;
  /** ZimaOS account used by the service to authenticate against supported APIs. */
  zimaosUsername: string;
  /** Password for the ZimaOS account above. Never logged, never returned via MCP. */
  zimaosPassword: string;
  /** Bearer token required on every MCP request. No default is shipped. */
  mcpAuthToken: string;
  /** When false (default) all application control tools are denied. */
  allowAppControl: boolean;
  /**
   * When false (default) all application install operations are denied.
   * Independent of ALLOW_APP_CONTROL. loadConfig always sets it explicitly;
   * the optionality only lets test fixtures omit it, in which case the safe
   * default-off value applies.
   */
  allowAppInstall?: boolean;
  /**
   * When false (default) all application uninstall operations are denied.
   * Independent of ALLOW_APP_CONTROL and ALLOW_APP_INSTALL: enabling either
   * does not enable this one. loadConfig always sets it explicitly; the
   * optionality only lets test fixtures omit it, in which case the safe
   * default-off value applies.
   */
  allowAppUninstall?: boolean;
  /** Independent, default-off permission for existing-app Compose edits. */
  allowAppEdit?: boolean;
  /** TCP port the HTTP server listens on. */
  port: number;
  /** debug | info | warn | error */
  logLevel: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function rejectPlaceholder(value: string, name: string): void {
  if (/^(?:change[_ -]?me|replace[_ -]?me)(?:[_ -]|$)/i.test(value.trim())) {
    throw new ConfigError(`${name} must replace the shipped placeholder.`);
  }
}

/** Minimum acceptable length for the MCP bearer token. */
export const MIN_MCP_TOKEN_LENGTH = 32;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseBool(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new ConfigError(
    `Invalid boolean value for ${name}: expected true/false/1/0/yes/no.`,
  );
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigError("Invalid PORT: expected an integer between 1 and 65535.");
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigError(`Invalid PORT: expected an integer between 1 and 65535.`);
  }
  return parsed;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value.trim() === "") return "info";
  const normalized = value.trim().toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(normalized)) {
    return normalized as LogLevel;
  }
  throw new ConfigError(`Invalid LOG_LEVEL: expected one of ${LOG_LEVELS.join(", ")}.`);
}

function parseZimaosUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(
      "ZIMAOS_URL is required. Set it to the base URL of your ZimaOS instance.",
    );
  }
  let url: URL;
  const trimmed = value.trim();
  const invalid =
    "Invalid ZIMAOS_URL: expected an http(s) origin without credentials, path, query or fragment.";
  if (!/^https?:\/\//i.test(trimmed) || /[\\\s?#]/u.test(trimmed)) {
    throw new ConfigError(invalid);
  }
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError(invalid);
  }
  if (url.username || url.password || url.pathname !== "/") {
    throw new ConfigError(invalid);
  }
  return url.origin;
}

/**
 * Load and validate configuration from an environment map (defaults to process.env).
 *
 * Errors are descriptive but never include secret values: only variable names,
 * expected formats. No supplied configuration value is safe to reflect.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const zimaosUrl = parseZimaosUrl(env["ZIMAOS_URL"]);

  const username = env["ZIMAOS_USERNAME"];
  if (username === undefined || username.trim() === "") {
    throw new ConfigError("ZIMAOS_USERNAME is required.");
  }

  const password = env["ZIMAOS_PASSWORD"];
  if (password === undefined || password === "") {
    throw new ConfigError(
      "ZIMAOS_PASSWORD is required. It must be a non-empty value; the value itself is never logged.",
    );
  }

  const mcpAuthToken = env["MCP_AUTH_TOKEN"];
  if (mcpAuthToken === undefined || mcpAuthToken.trim() === "") {
    throw new ConfigError(
      "MCP_AUTH_TOKEN is required. Generate a strong random token, e.g.: openssl rand -hex 32",
    );
  }
  if (mcpAuthToken.length < MIN_MCP_TOKEN_LENGTH) {
    throw new ConfigError(
      `MCP_AUTH_TOKEN must be at least ${MIN_MCP_TOKEN_LENGTH} characters long.`,
    );
  }

  rejectPlaceholder(username, "ZIMAOS_USERNAME");
  rejectPlaceholder(password, "ZIMAOS_PASSWORD");
  rejectPlaceholder(mcpAuthToken, "MCP_AUTH_TOKEN");
  if (/\s/u.test(mcpAuthToken)) {
    throw new ConfigError("MCP_AUTH_TOKEN must not contain whitespace.");
  }

  return {
    zimaosUrl,
    zimaosUsername: username.trim(),
    zimaosPassword: password,
    mcpAuthToken,
    allowAppControl: parseBool(env["ALLOW_APP_CONTROL"], "ALLOW_APP_CONTROL"),
    allowAppInstall: parseBool(env["ALLOW_APP_INSTALL"], "ALLOW_APP_INSTALL"),
    allowAppUninstall: parseBool(env["ALLOW_APP_UNINSTALL"], "ALLOW_APP_UNINSTALL"),
    allowAppEdit: parseBool(env["ALLOW_APP_EDIT"], "ALLOW_APP_EDIT"),
    port: parsePort(env["PORT"]),
    logLevel: parseLogLevel(env["LOG_LEVEL"]),
  };
}
