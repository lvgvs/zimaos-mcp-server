/**
 * Shared fake-fetch harness for ZimaOS API tests.
 *
 * The fake records every request (method, path, headers, body) and answers
 * from a route table keyed by "METHOD /path". Routes may be static values or
 * functions of the recorded call index — this lets tests model stateful
 * behavior such as "first 401, then success after re-login" without any
 * network access.
 */

import type { AppError } from "../../src/errors.js";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

type RouteHandler = (callIndex: number) => unknown | Promise<unknown>;

interface RouteSpec {
  status?: number;
  /** JSON-serializable response body. */
  json?: unknown;
  /** Raw text response body (e.g. a log tail). */
  text?: string;
  /** When set, the fake throws this AppError instead of responding. */
  error?: AppError;
}

export class FakeZimaOs {
  readonly requests: RecordedRequest[] = [];
  private routes = new Map<string, RouteSpec[]>();
  private counters = new Map<string, number>();

  /** Register a route. Multiple registrations for the same key are consumed in order. */
  on(method: string, path: string, spec: RouteSpec): this {
    const key = `${method} ${path}`;
    const list = this.routes.get(key) ?? [];
    list.push(spec);
    this.routes.set(key, list);
    return this;
  }

  /** Convenience: successful JSON envelope `{ success: true, data }`. */
  ok(method: string, path: string, data: unknown): this {
    return this.on(method, path, { json: { success: true, message: "ok", data } });
  }

  /** Convenience: bare (non-envelope) JSON payload. */
  raw(method: string, path: string, body: unknown): this {
    return this.on(method, path, { json: body });
  }

  get calls(): RecordedRequest[] {
    return this.requests;
  }

  /** The fetch implementation to inject into ZimaOsClient. */
  readonly fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) {
      headers[k.toLowerCase()] = String(v);
    }
    const body = init?.body === undefined ? undefined : String(init.body);
    this.requests.push({ method, path, headers, body });

    const key = `${method} ${path}`;
    const list = this.routes.get(key) ?? [];
    const index = this.counters.get(key) ?? 0;
    this.counters.set(key, index + 1);

    // A route may be a function of the call index for stateful scenarios.
    let spec: RouteSpec | undefined;
    if (typeof list[index] === "function") {
      const handler = list[index] as unknown as RouteHandler;
      const result = await handler(index);
      spec = isRouteSpec(result) ? result : { json: result };
    } else {
      // Last registered route wins when the sequence is exhausted.
      spec = list[Math.min(index, list.length - 1)];
    }

    if (spec === undefined) {
      throw new Error(`FakeZimaOs: no route for ${key} (call #${index + 1})`);
    }
    if (spec.error !== undefined) {
      throw spec.error;
    }
    const status = spec.status ?? 200;
    let text: string;
    if (spec.text !== undefined) {
      text = spec.text;
    } else if (spec.json === undefined && spec.text === undefined) {
      text = "";
    } else {
      text = JSON.stringify(spec.json);
    }
    return new Response(text, { status });
  }) as typeof fetch;
}

function isRouteSpec(value: unknown): value is RouteSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["status"] !== undefined ||
    v["json"] !== undefined ||
    v["text"] !== undefined ||
    v["error"] !== undefined
  );
}
