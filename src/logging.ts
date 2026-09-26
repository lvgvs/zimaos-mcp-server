/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line to stdout so container log collectors can parse
 * it. Never includes secrets; callers are responsible for not passing sensitive
 * values here (see AGENTS.md security model).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

let threshold: LogLevel = "info";

/** Set the minimum level that will be emitted. */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    message,
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) entry[k] = v;
    }
  }
  // Single line, stable key order is not required.
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
