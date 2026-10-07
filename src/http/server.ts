/**
 * MCP transport layer: authenticated Streamable HTTP over node:http, built on
 * the SDK v2 split packages.
 *
 * - POST/GET/DELETE /mcp  -> MCP (bearer-authenticated).
 * - GET /health          -> lightweight readiness probe (no secrets, no auth).
 *
 * One `createMcpHandler(factory)` plus one `toNodeHandler` are created once per
 * HTTP server lifecycle. The factory hands the handler a fresh McpServer for
 * every MCP request, so each exchange is isolated; the shared services are
 * injected once and closed over by that per-request server. The handler serves
 * the modern (2026-07-28) protocol and falls back to old-school stateless
 * serving for 2025-era traffic (`legacy: 'stateless'`).
 */

import http from "node:http";
import crypto from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { defaultChallengeLedger } from "../approval/challengeLedger.js";
import { sha256Hex } from "../approval/intent.js";
import { createPendingInstallRequestStateCodec } from "../approval/requestState.js";
import type { AppConfig } from "../config.js";
import { logger } from "../logging.js";
import { createMcpServer, type ToolDeps } from "../mcp/tools.js";

/** Hard cap on MCP request bodies (tool calls are small JSON). */
const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MiB

export interface HttpServerOptions {
  config: AppConfig;
  deps: ToolDeps;
  /** Optional readiness probe (e.g. "is a ZimaOS session active?"). */
  isReady?: () => boolean | Promise<boolean>;
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
  const header = authorizationHeader.trim();
  // Fixed-size scheme check, then linear built-in trimming; no overlapping regex scans.
  if (header.slice(0, 6).toLowerCase() !== "bearer" || header[6]?.trim() !== "") {
    return false;
  }
  const token = header.slice(6).trim();
  // Preserve the previous single-line credential syntax (including JS whitespace trimming).
  if (
    !token ||
    token.includes("\r") ||
    token.includes("\n") ||
    token.includes("\u2028") ||
    token.includes("\u2029")
  ) {
    return false;
  }
  const provided = Buffer.from(token, "utf8");
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
  // One ephemeral signing key per HTTP server, one process-wide single-use ledger.
  // The bearer-authenticated deployment is the single principal in this release.
  const principal = sha256Hex(config.mcpAuthToken);
  const approval: NonNullable<ToolDeps["approval"]> = {
    ledger: defaultChallengeLedger,
    codec: createPendingInstallRequestStateCodec({ principal }),
    principal,
    target: config.zimaosUrl,
  };

  // One handler per HTTP server lifecycle. The factory returns a fresh McpServer
  // for every MCP request (modern and stateless legacy alike), so exchanges are
  // isolated while the shared services stay injected once.
  const mcpHandler = createMcpHandler(() => createMcpServer({ ...deps, approval }), {
    legacy: "stateless",
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    onerror: () => logger.error("mcp_request_failed", { code: "INTERNAL" }),
  });

  // Wrap the web-standard handler once for node:http. The adapter buffers the
  // body under the same bound and answers 413 before anything is parsed.
  const mcpNodeHandler = toNodeHandler(mcpHandler, {
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    onerror: () => logger.error("mcp_request_failed", { code: "INTERNAL" }),
  });

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  // Graceful shutdown: tear down in-flight modern exchanges when the HTTP server
  // closes (the stateless legacy leg holds nothing between requests).
  server.on("close", () => {
    void mcpHandler.close().catch(() => undefined);
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ------------------------------------------------------- health probe --
    if (path === "/health" && req.method === "GET") {
      let ready = false;
      try {
        ready = (await options.isReady?.()) ?? true;
      } catch {
        // Probe errors must fail closed without reflecting upstream/config secrets.
      }
      sendJson(res, ready ? 200 : 503, {
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

    // Auth before MCP: unauthenticated requests never reach the handler.
    if (!bearerMatches(req.headers["authorization"], config.mcpAuthToken)) {
      logger.warn("rejected_unauthenticated_mcp_request", { method: req.method });
      res.setHeader("www-authenticate", 'Bearer realm="zimaos-mcp-server"');
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    try {
      await mcpNodeHandler(req, res);
    } catch {
      logger.error("mcp_request_failed", { code: "INTERNAL" });
      if (!res.headersSent) {
        sendJson(res, 502, { error: "upstream_error" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  return server;
}
