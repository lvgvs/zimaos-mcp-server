/**
 * zimaos-mcp-server entrypoint.
 *
 * Boots configuration, authenticates against ZimaOS (fail-fast; container
 * restart policy retries until ZimaOS is reachable), then serves the
 * authenticated Streamable HTTP MCP endpoint plus a /health probe.
 */

import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logging.js";
import { ZimaOsClient } from "./zimaos/client.js";
import { AppService } from "./zimaos/appService.js";
import { SystemService } from "./zimaos/systemService.js";
import { PermissionLayer } from "./permissions.js";
import type { ToolDeps } from "./mcp/tools.js";
import { createHttpServer } from "./http/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const client = new ZimaOsClient({
    baseUrl: config.zimaosUrl,
    username: config.zimaosUsername,
    password: config.zimaosPassword,
  });

  // Fail fast on bad credentials / unreachable ZimaOS. The container restart
  // policy retries until the host is up; no half-configured state is served.
  try {
    await client.login();
  } catch (err) {
    logger.error("zimaos_login_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
    return;
  }

  const deps: ToolDeps = {
    apps: new AppService(client),
    system: new SystemService(client),
    permissions: new PermissionLayer({
      allowAppControl: config.allowAppControl,
      allowAppInstall: config.allowAppInstall,
      allowAppUninstall: config.allowAppUninstall,
    }),
  };

  const server = createHttpServer({
    config,
    deps,
    isReady: () => client.hasSession(),
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, resolve);
  });
  logger.info("server_listening", { port: config.port });

  const shutdown = (signal: string): void => {
    logger.info("shutting_down", { signal });
    server.close(() => process.exit(0));
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("fatal_startup_error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
