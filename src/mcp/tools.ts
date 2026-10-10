/**
 * MCP tool layer.
 *
 * Builds a fresh McpServer with all Phase 1 tools registered against injected
 * services (dependency injection keeps this testable without a live ZimaOS).
 * A new server is created per request because the stateless Streamable HTTP
 * transport requires one connected server+transport pair per request.
 */

import {
  McpServer,
  acceptedContent,
  inputRequired,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ChallengeLedger } from "../approval/challengeLedger.js";
import {
  buildPendingInstallIntents,
  buildStoreInstallIntents,
} from "../approval/intent.js";
import { buildEditIntents } from "../approval/editIntent.js";
import {
  type createPendingInstallRequestStateCodec,
  parsePendingInstallPayload,
  parsePendingEditPayload,
  parsePendingStoreInstallPayload,
  type PendingStoreInstallPayload,
  type PendingInstallPayload,
  type PendingEditPayload,
} from "../approval/requestState.js";
import { AppError } from "../errors.js";
import type { PermissionLayer } from "../permissions.js";
import type { AppService } from "../zimaos/appService.js";
import type { SystemService } from "../zimaos/systemService.js";

export interface ToolDeps {
  apps: AppService;
  system: SystemService;
  permissions: PermissionLayer;
  approval?: {
    ledger: ChallengeLedger;
    codec: ReturnType<typeof createPendingInstallRequestStateCodec>;
    principal: string;
    target: string;
  };
}

/** Default log tail when the caller does not specify one. */
const DEFAULT_LOG_LINES = 100;
/** Hard cap on requested log lines (bounded output requirement). */
const MAX_LOG_LINES = 500;
/**
 * Bounded nonempty source limit for compose tools: mirrors the parseCompose
 * UTF-8 input limit so oversized sources are rejected by the schema instead
 * of reaching the parser.
 */
const MAX_SOURCE_BYTES = 512 * 1024;

const appIdSchema = z.string().min(1).describe("Stable application identifier.");

/** Bounded nonempty compose source, consistent with the parseCompose limit. */
const composeSourceSchema = z
  .string()
  .min(1)
  .max(MAX_SOURCE_BYTES)
  .refine((source) => Buffer.byteLength(source, "utf8") <= MAX_SOURCE_BYTES, {
    message: "Compose source exceeds the UTF-8 byte limit.",
  })
  .describe(`Docker Compose YAML (nonempty, at most ${MAX_SOURCE_BYTES} bytes).`);

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Convert a thrown AppError into an MCP error result (no stack traces). */
function errorResult(err: unknown): CallToolResult {
  if (err instanceof AppError) {
    return textResult(`[${err.code}] ${err.message}`);
  }
  // Never leak internal details for unexpected errors.
  return textResult("[INTERNAL] Unexpected error.");
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
  const server = new McpServer(
    { name: "zimaos-mcp-server", version: "0.1.0" },
    {
      inputRequired: { legacyShim: false },
      ...(deps.approval && { requestState: { verify: deps.approval.codec.verify } }),
    },
  );

  // ------------------------------------------------------------- read-only --

  server.registerTool(
    "list_apps",
    {
      title: "List installed applications",
      description:
        "Returns a concise normalized list of applications installed on the ZimaOS host.",
      inputSchema: z.object({}),
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
      inputSchema: z.object({ app_id: appIdSchema }),
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
      inputSchema: z.object({ app_id: appIdSchema }),
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
      inputSchema: z.object({
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
      }),
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
      inputSchema: z.object({ app_id: appIdSchema }),
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
      inputSchema: z.object({}),
    },
    guard(async () => {
      const info = await deps.system.getSystemInfo();
      return textResult(JSON.stringify({ system: info }));
    }),
  );

  // Non-mutating Compose validation. Read-only by design, so it is available
  // without any app-control permission flag; nothing is installed or changed.
  server.registerTool(
    "validate_app_compose",
    {
      title: "Validate an application Compose document",
      description:
        "Validates a Docker Compose document against the ZimaOS dry-run endpoint and local risk analysis without installing or mutating anything. Returns structured JSON with the normalized validation status plus fixed-shape risk findings (findings are data, not errors). Read-only; no app-control permission is required.",
      inputSchema: z.object({
        source: composeSourceSchema,
      }),
    },
    guard(async (args) => {
      const source = String(args["source"]);
      try {
        const validation = await deps.apps.validateCompose(source);
        return textResult(JSON.stringify(validation));
      } catch (err) {
        // Normalized AppErrors pass through to the guard below. Unexpected
        // failures must not echo raw input or internal details to the client.
        if (!(err instanceof AppError)) {
          throw new AppError("INTERNAL", "compose validation failed unexpectedly.");
        }
        throw err;
      }
    }),
  );

  server.registerTool(
    "get_app_compose",
    {
      title: "Read an installed application's Compose",
      description:
        "Returns the bounded, interpolated ZimaOS Compose YAML and a SHA-256 fingerprint of those returned bytes. It is not the original stored source. Treat application configuration as sensitive; ZimaOS credential-bearing configurations are refused.",
      inputSchema: z.object({ app_id: appIdSchema }),
    },
    guard(async (args) =>
      textResult(JSON.stringify(await deps.apps.getAppCompose(String(args["app_id"])))),
    ),
  );

  server.registerTool(
    "validate_app_compose_change",
    {
      title: "Validate a proposed edit to an installed application",
      description:
        "Checks the current Compose fingerprint, exact project identity, local risk delta and the official ZimaOS PUT dry-run with port conflict checking. Never mutates. A successful dry-run does not grant edit permission.",
      inputSchema: z.object({
        app_id: appIdSchema,
        expected_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        source: composeSourceSchema,
      }),
    },
    guard(async (args) =>
      textResult(
        JSON.stringify(
          await deps.apps.validateAppComposeChange(
            String(args["app_id"]),
            String(args["expected_fingerprint"]),
            String(args["source"]),
          ),
        ),
      ),
    ),
  );

  server.registerTool(
    "edit_app_compose",
    {
      title: "Edit an installed application's Compose (default off)",
      description:
        "Applies a benign exact-source edit only when ALLOW_APP_EDIT=true and the base fingerprint still matches. Risky edits require modern single-use approval. Acceptance is not completion.",
      inputSchema: z.object({
        app_id: appIdSchema,
        expected_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        source: composeSourceSchema,
      }),
    },
    async (args, ctx) => {
      const id = String(args["app_id"]);
      const base = String(args["expected_fingerprint"]);
      const source = String(args["source"]);
      try {
        deps.permissions.assertCanEdit();
        const approval = deps.approval;
        const modern = server.server.getNegotiatedProtocolVersion() === "2026-07-28";
        const state = ctx.mcpReq.requestState();
        if (state !== undefined || ctx.mcpReq.inputResponses !== undefined) {
          if (!approval || !modern || state === undefined) {
            throw new AppError("INPUT_INVALID", "Invalid approval continuation.");
          }
          const payload = parsePendingEditPayload(state);
          const content = acceptedContent(ctx.mcpReq.inputResponses, "approve_edit");
          if (!z.object({ confirm: z.literal(true) }).safeParse(content).success) {
            throw new AppError("INPUT_INVALID", "Approval was not accepted.");
          }
          return textResult(
            JSON.stringify(
              await deps.apps.editApprovedAppCompose(
                id,
                base,
                source,
                deps.permissions,
                payload,
                approval.target,
                approval.principal,
                approval.ledger,
              ),
            ),
          );
        }
        const result = await deps.apps.editAppCompose(id, base, source, deps.permissions);
        if (result.status !== "confirmation_required")
          return textResult(JSON.stringify(result));
        if (!approval || !modern) {
          throw new AppError(
            "INPUT_INVALID",
            "Risky editing requires modern MCP elicitation.",
          );
        }
        const intents = buildEditIntents({
          id,
          baseFingerprint: base,
          source,
          risks: result.risks,
          target: approval.target,
        });
        const challenge = approval.ledger.issue({
          tool: "edit_app_compose",
          contentFingerprint: intents.contentSha256,
          principal: approval.principal,
        });
        const pending: PendingEditPayload = {
          version: 1,
          challengeId: challenge.id,
          tool: "edit_app_compose",
          ...intents,
          expiresAtMs: challenge.expiresAtMs,
        };
        const requestState = await approval.codec.mint(pending, ctx);
        const disclosure = {
          introduced: result.risks.introduced,
          escalated: result.risks.escalated,
          unchangedCount: result.risks.unchanged.length,
          removedCount: result.risks.removed.length,
        };
        return inputRequired({
          requestState,
          inputRequests: {
            approve_edit: inputRequired.elicit({
              message: `Risk-increasing existing-app Compose edit requires explicit confirmation. Operation: edit_app_compose. App: ${id}. Base SHA-256: ${base}. Exact proposed UTF-8 SHA-256: ${intents.contentSha256}. Risk delta: ${JSON.stringify(disclosure)}. Approval expires within 300 seconds. Decline to cancel.`,
              requestedSchema: {
                type: "object",
                properties: {
                  confirm: {
                    type: "boolean",
                    title: "Approve this exact existing-app edit",
                  },
                },
                required: ["confirm"],
              },
            }),
          },
        });
      } catch (err) {
        const normalized =
          err instanceof AppError
            ? err
            : new AppError("INTERNAL", "compose edit failed unexpectedly.");
        return { ...errorResult(normalized), isError: true };
      }
    },
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
        inputSchema: z.object({ app_id: appIdSchema }),
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

  // ------------------------------------------------------- install (2C/2D) --

  // Safe compose installation. Mutating: requires the separate, default-off
  // ALLOW_APP_INSTALL permission; the service layer re-asserts it itself, so a
  // disabled policy fails closed with zero upstream traffic. Outcomes are
  // fixed-shape data (accepted / rejected / upstream_error); a risky document
  // returns confirmation_required WITHOUT mutation on legacy requests. Modern
  // approval requires server-minted signed state and an accepted elicitation.
  server.registerTool(
    "install_app_from_compose",
    {
      title: "Install an application from a Compose document",
      description:
        "Installs a Docker Compose application on the ZimaOS host after safe preflight (permission check, duplicate-identity check, dry-run validation). Requires ALLOW_APP_INSTALL=true; otherwise returns a clear permission error. Returns fixed-shape JSON data: {status:'confirmation_required',name,findings} when local risk analysis requires explicit user confirmation (nothing is installed on that path), or {status:'accepted'|'rejected'|'upstream_error',accepted:boolean} after exactly one install attempt. 'accepted' means the asynchronous request was accepted by ZimaOS — it is NOT completion and no app ID can be inferred from it.",
      inputSchema: z.object({
        source: composeSourceSchema,
      }),
    },
    async (args, ctx) => {
      const source = String(args["source"]);
      try {
        const approval = deps.approval;
        const modern = server.server.getNegotiatedProtocolVersion() === "2026-07-28";
        const state = ctx.mcpReq.requestState();
        if (state !== undefined || ctx.mcpReq.inputResponses !== undefined) {
          if (!approval || !modern || state === undefined) {
            throw new AppError("INPUT_INVALID", "Invalid approval continuation.");
          }
          const payload = parsePendingInstallPayload(state);
          const content = acceptedContent(ctx.mcpReq.inputResponses, "approve_install");
          if (!z.object({ confirm: z.literal(true) }).safeParse(content).success) {
            throw new AppError("INPUT_INVALID", "Approval was not accepted.");
          }
          const outcome = await deps.apps.installApprovedCompose(
            source,
            deps.permissions,
            payload,
            approval.target,
            approval.principal,
            approval.ledger,
          );
          if (outcome.status !== "accepted") return textResult(JSON.stringify(outcome));
          // One bounded read-only observation. An async acceptance is never
          // described as completion; an unavailable/stale list stays pending.
          let observation: "observed" | "pending" = "pending";
          try {
            const apps = await deps.apps.listApps();
            if (apps.some((app) => app.id === payload.intendedAppName)) {
              observation = "observed";
            }
          } catch {
            // Do not turn a successful one-shot POST into a retryable error.
          }
          return textResult(JSON.stringify({ ...outcome, reconciliation: observation }));
        }
        const result = await deps.apps.installSafeCompose(source, deps.permissions);
        if (result.status === "confirmation_required" && approval) {
          if (!modern) {
            throw new AppError(
              "INPUT_INVALID",
              "Risky installation requires modern MCP elicitation.",
            );
          }
          const intents = buildPendingInstallIntents({
            source,
            name: result.name,
            findings: result.findings,
            target: approval.target,
          });
          const challenge = approval.ledger.issue({
            tool: "install_app_from_compose",
            contentFingerprint: intents.contentSha256,
            principal: approval.principal,
          });
          const pending: PendingInstallPayload = {
            version: 1,
            challengeId: challenge.id,
            tool: "install_app_from_compose",
            ...intents,
            expiresAtMs: challenge.expiresAtMs,
          };
          const requestState = await approval.codec.mint(pending, ctx);
          const disclosure = result.findings.map(({ category, field, description }) => ({
            category,
            field,
            description,
          }));
          return inputRequired({
            requestState,
            inputRequests: {
              approve_install: inputRequired.elicit({
                message: `Risky Compose installation requires explicit confirmation. Operation: install_app_from_compose. Name: ${result.name}. Exact UTF-8 SHA-256: ${intents.contentSha256}. Findings: ${JSON.stringify(disclosure)}. Approval expires within 300 seconds. Decline to cancel.`,
                requestedSchema: {
                  type: "object",
                  properties: {
                    confirm: {
                      type: "boolean",
                      title: "Approve this exact installation",
                    },
                  },
                  required: ["confirm"],
                },
              }),
            },
          });
        }
        return textResult(JSON.stringify(result));
      } catch (err) {
        const normalized =
          err instanceof AppError
            ? err
            : new AppError("INTERNAL", "compose install failed unexpectedly.");
        return { ...errorResult(normalized), isError: true };
      }
    },
  );

  server.registerTool(
    "install_app_from_store",
    {
      title: "Install a registered App Store application",
      description:
        "Installs only a Compose-class app from an enabled registered ZimaOS repository, using the server-selected current architecture. Requires ALLOW_APP_INSTALL=true. Applies exact-content risk analysis, controlled dry-run and modern elicitation for risky installs. No URLs, force, update or uncontrolled option. One mutation attempt; accepted is asynchronous acceptance, not completion. Bounded reconciliation reports observed, pending or unknown; observed running/healthy is not proof of completion.",
      inputSchema: z
        .object({
          repo_id: z
            .string()
            .min(1)
            .max(128)
            .describe("Exact enabled registered repository identifier, not a URL."),
          app_id: z
            .string()
            .min(1)
            .max(192)
            .describe(
              "Exact canonical lower-case reverse-domain catalog app identifier.",
            ),
        })
        .strict(),
    },
    async (args, ctx) => {
      try {
        deps.permissions.assertCanInstall("install_app_from_store");
        const selection = { repoId: args.repo_id, appId: args.app_id };
        const approval = deps.approval;
        const modern = server.server.getNegotiatedProtocolVersion() === "2026-07-28";
        const state = ctx.mcpReq.requestState();
        if (state !== undefined || ctx.mcpReq.inputResponses !== undefined) {
          if (!approval || !modern || state === undefined) {
            throw new AppError("INPUT_INVALID", "Invalid approval continuation.");
          }
          const payload = parsePendingStoreInstallPayload(state);
          const content = acceptedContent(
            ctx.mcpReq.inputResponses,
            "approve_store_install",
          );
          if (!z.object({ confirm: z.literal(true) }).safeParse(content).success) {
            throw new AppError("INPUT_INVALID", "Approval was not accepted.");
          }
          return textResult(
            JSON.stringify(
              await deps.apps.installApprovedStoreApp(
                selection,
                deps.permissions,
                payload,
                approval.target,
                approval.principal,
                approval.ledger,
              ),
            ),
          );
        }
        const result = await deps.apps.installStoreApp(selection, deps.permissions);
        if (result.status !== "confirmation_required")
          return textResult(JSON.stringify(result));
        if (!approval || !modern) {
          throw new AppError(
            "INPUT_INVALID",
            "Risky store installation requires modern MCP elicitation.",
          );
        }
        const intents = buildStoreInstallIntents({
          source: result.source,
          name: result.name,
          findings: result.findings,
          selection,
          target: approval.target,
        });
        const challenge = approval.ledger.issue({
          tool: "install_app_from_store",
          contentFingerprint: intents.contentSha256,
          principal: approval.principal,
        });
        const pending: PendingStoreInstallPayload = {
          version: 1,
          tool: "install_app_from_store",
          challengeId: challenge.id,
          ...intents,
          expiresAtMs: challenge.expiresAtMs,
        };
        const requestState = await approval.codec.mint(pending, ctx);
        const disclosure = result.findings.map(({ category, field, description }) => ({
          category,
          field,
          description,
        }));
        return inputRequired({
          requestState,
          inputRequests: {
            approve_store_install: inputRequired.elicit({
              message: `Risky native store installation requires explicit confirmation. Operation: install_app_from_store. Repository: ${selection.repoId}. Catalog app: ${selection.appId}. Name: ${result.name}. Exact final UTF-8 SHA-256: ${intents.contentSha256}. Findings: ${JSON.stringify(disclosure)}. Approval expires within 300 seconds. Decline to cancel.`,
              requestedSchema: {
                type: "object",
                properties: {
                  confirm: {
                    type: "boolean",
                    title: "Approve this exact store installation",
                  },
                },
                required: ["confirm"],
              },
            }),
          },
        });
      } catch (err) {
        return { ...errorResult(err), isError: true };
      }
    },
  );

  // Separate default-off permission; explicit id only, no filesystem cleanup.
  server.registerTool(
    "uninstall_app",
    {
      title: "Uninstall an installed Compose application",
      description:
        "Requests one asynchronous uninstall of an explicitly identified installed Compose app. Requires ALLOW_APP_UNINSTALL=true. Sets delete_config_folder=false; exposes no separate filesystem/volume cleanup capability. An accepted response is not completion; reconciliation is a bounded read-only observation.",
      inputSchema: z.object({ app_id: z.string().min(1).max(128) }),
    },
    guard(async (args) => {
      const result = await deps.apps.uninstallApp(
        String(args["app_id"]),
        deps.permissions,
      );
      return textResult(JSON.stringify(result));
    }),
  );

  return server;
}
