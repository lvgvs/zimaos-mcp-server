/**
 * MCP tool layer.
 *
 * Builds a fresh McpServer with all Phase 1 tools registered against injected
 * services (dependency injection keeps this testable without a live ZimaOS).
 * A new server is created per request because the stateless Streamable HTTP
 * transport requires one connected server+transport pair per request.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { PermissionLayer } from "../permissions.js";
import type { AppService } from "../zimaos/appService.js";
import type { SystemService } from "../zimaos/systemService.js";

export interface ToolDeps {
  apps: AppService;
  system: SystemService;
  permissions: PermissionLayer;
}

/** Default log tail when the caller does not specify one. */
const DEFAULT_LOG_LINES = 100;
/** Hard cap on requested log lines (bounded output requirement). */
const MAX_LOG_LINES = 500;

const appIdSchema = z.string().min(1).describe("Stable application identifier.");

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Convert a thrown AppError into an MCP error result (no stack traces). */
function errorResult(err: unknown): CallToolResult {
  if (err instanceof AppError) {
    return textResult(`[${err.code}] ${err.message}`);
  }
  // Never leak internal details for unexpected errors.
  const message = err instanceof Error ? err.message : String(err);
  return textResult(`[INTERNAL] Unexpected error: ${message}`);
}

/** Wrap a tool handler so AppErrors become normalized MCP error results. */
function guard(
  fn: (args: Record<string, unknown>) => Promise<CallToolResult>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      const result = errorResult(err);
      // Mark as an MCP tool error so clients can distinguish it from text.
      return { ...result, isError: true };
    }
  };
}

export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "zimaos-mcp-server", version: "0.1.0" });

  // ------------------------------------------------------------- read-only --

  server.registerTool(
    "list_apps",
    {
      title: "List installed applications",
      description:
        "Returns a concise normalized list of applications installed on the ZimaOS host.",
      inputSchema: {},
    },
    guard(async () => {
      const apps = await deps.apps.listApps();
      return textResult(JSON.stringify({ apps }));
    }),
  );

  server.registerTool(
    "get_app",
    {
      title: "Get one application",
      description:
        "Returns normalized information for a single installed application by its stable id.",
      inputSchema: { app_id: appIdSchema },
    },
    guard(async (args) => {
      const app = await deps.apps.getApp(String(args["app_id"]));
      return textResult(JSON.stringify({ app }));
    }),
  );

  server.registerTool(
    "get_app_health",
    {
      title: "Get application health",
      description:
        "Returns available health/state information for an application and its containers. Health is only reported when ZimaOS exposes it; otherwise the state is 'unknown'.",
      inputSchema: { app_id: appIdSchema },
    },
    guard(async (args) => {
      const health = await deps.apps.getAppHealth(String(args["app_id"]));
      return textResult(JSON.stringify(health));
    }),
  );

  server.registerTool(
    "get_app_logs",
    {
      title: "Get recent application logs",
      description: `Returns a bounded tail of an application's container logs (default ${DEFAULT_LOG_LINES} lines, max ${MAX_LOG_LINES}). Application-generated log content may itself contain sensitive data outside this server's control.`,
      inputSchema: {
        app_id: appIdSchema,
        lines: z
          .number()
          .int()
          .min(1)
          .max(MAX_LOG_LINES)
          .optional()
          .describe(
            `Maximum number of log lines to return (default ${DEFAULT_LOG_LINES}, max ${MAX_LOG_LINES}).`,
          ),
      },
    },
    guard(async (args) => {
      const requested = args["lines"];
      const lines =
        typeof requested === "number" && Number.isInteger(requested)
          ? Math.min(Math.max(requested, 1), MAX_LOG_LINES)
          : DEFAULT_LOG_LINES;
      const text = await deps.apps.getLogs(String(args["app_id"]), lines);
      return textResult(text.length > 0 ? text : "(no logs available)");
    }),
  );

  server.registerTool(
    "list_app_containers",
    {
      title: "List application containers",
      description:
        "Returns normalized container/service information for an installed application.",
      inputSchema: { app_id: appIdSchema },
    },
    guard(async (args) => {
      const containers = await deps.apps.listContainers(String(args["app_id"]));
      return textResult(JSON.stringify({ containers }));
    }),
  );

  server.registerTool(
    "get_system_info",
    {
      title: "Get system info",
      description:
        "Returns a small normalized summary of the ZimaOS system (device, OS version, CPU/memory basics).",
      inputSchema: {},
    },
    guard(async () => {
      const info = await deps.system.getSystemInfo();
      return textResult(JSON.stringify({ system: info }));
    }),
  );

  // ------------------------------------------------- reversible controls --

  const controlTool = (name: string, action: "start" | "stop" | "restart") => {
    const titles: Record<"start" | "stop" | "restart", string> = {
      start: "Start an application",
      stop: "Stop an application",
      restart: "Restart an application",
    };
    server.registerTool(
      name,
      {
        title: titles[action],
        description: `Reversibly ${action}s an installed application. Requires ALLOW_APP_CONTROL=true; otherwise returns a clear permission error.`,
        inputSchema: { app_id: appIdSchema },
      },
      guard(async (args) => {
        const id = String(args["app_id"]);
        deps.permissions.assertCanControl(name);
        if (action === "start") await deps.apps.startApp(id);
        else if (action === "stop") await deps.apps.stopApp(id);
        else await deps.apps.restartApp(id);
        return textResult(JSON.stringify({ ok: true, app_id: id, action }));
      }),
    );
  };

  controlTool("start_app", "start");
  controlTool("stop_app", "stop");
  controlTool("restart_app", "restart");

  return server;
}
