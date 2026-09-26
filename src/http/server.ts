/**
 * MCP transport layer: authenticated Streamable HTTP over node:http.
 *
 * - POST/GET/DELETE /mcp  -> MCP Streamable HTTP (bearer-authenticated).
 * - GET /health          -> lightweight readiness probe (no secrets, no auth).
 *
 * Stateless mode is required for a remote multi-client server: the SDK forbids
 * reusing one stateless transport across requests, so every MCP request gets
 * its own fresh McpServer + StreamableHTTPServerTransport pair. The shared
 * services are injected once and closed over by each per-request server.
 */

import http from "node:http";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "../config.js";
import { logger } from "../logging.js";
import { createMcpServer, type ToolDeps } from "../mcp/tools.js";

/** Hard cap on MCP request bodies (tool calls are small JSON). */
const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MiB

export interface HttpServerOptions {
  config: AppConfig;
  deps: ToolDeps;
  /** Optional readiness probe (e.g. "is a ZimaOS session active?"). */
  isReady?: () => boolean;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Constant-time bearer token comparison (no default token ever exists). */
function bearerMatches(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match || !match[1]) return false;
  const provided = Buffer.from(match[1].trim(), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (provided.length !== expected.length) {
    // Still compare a fixed-size buffer to keep timing uniform.
    crypto.timingSafeEqual(provided, Buffer.alloc(provided.length));
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

export function createHttpServer(options: HttpServerOptions): http.Server {
  const { config, deps } = options;

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ------------------------------------------------------- health probe --
    if (path === "/health" && req.method === "GET") {
      const ready = options.isReady?.() ?? true;
      sendJson(res, 200, {
        status: ready ? "ok" : "degraded",
        service: "zimaos-mcp-server",
        ready,
      });
      return;
    }

    // ------------------------------------------------------------- MCP API --
    if (path !== "/mcp") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (!bearerMatches(req.headers["authorization"], config.mcpAuthToken)) {
      logger.warn("rejected_unauthenticated_mcp_request", { method: req.method });
      res.setHeader("www-authenticate", 'Bearer realm="zimaos-mcp-server"');
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    // Stateless Streamable HTTP: one fresh server+transport pair per request.
    const transport = new StreamableHTTPServerTransport({
      maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    });
    const mcpServer = createMcpServer(deps);
    await mcpServer.connect(transport);

    const cleanup = () => {
      // Idempotent; safe to run on both finish and close.
      void mcpServer.close().catch(() => undefined);
    };
    res.once("finish", cleanup);
    res.once("close", cleanup);

    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error("mcp_request_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        sendJson(res, 502, { error: "upstream_error" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  return server;
}
