import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, MIN_MCP_TOKEN_LENGTH } from "../src/config.js";

const VALID = {
  ZIMAOS_URL: "http://192.0.2.50",
  ZIMAOS_USERNAME: "admin",
  ZIMAOS_PASSWORD: "correct horse battery staple",
  MCP_AUTH_TOKEN: "a".repeat(48),
};

function envWith(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...VALID, ...overrides };
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
}

describe("loadConfig", () => {
  it("accepts a fully valid environment with defaults applied", () => {
    const cfg = loadConfig(envWith());
    expect(cfg.zimaosUrl).toBe("http://192.0.2.50");
    expect(cfg.zimaosUsername).toBe("admin");
    expect(cfg.allowAppControl).toBe(false); // default: control disabled
    expect(cfg.allowAppInstall).toBe(false); // default: install disabled
    expect(cfg.allowAppUninstall).toBe(false); // default: uninstall disabled
    expect(cfg.allowAppEdit).toBe(false); // independent default-off edit
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe("info");
  });

  it("normalizes trailing slashes on ZIMAOS_URL", () => {
    const cfg = loadConfig(envWith({ ZIMAOS_URL: "http://192.0.2.50/" }));
    expect(cfg.zimaosUrl).toBe("http://192.0.2.50");
  });

  it.each([
    ["missing", { ZIMAOS_URL: undefined }],
    ["not a URL", { ZIMAOS_URL: "not-a-url" }],
    ["wrong protocol", { ZIMAOS_URL: "ftp://192.0.2.50" }],
  ])("rejects invalid ZIMAOS_URL (%s)", (_name, overrides) => {
    expect(() => loadConfig(envWith(overrides))).toThrowError(ConfigError);
  });

  it.each([
    ["missing username", { ZIMAOS_USERNAME: undefined }],
    ["blank username", { ZIMAOS_USERNAME: "   " }],
    ["missing password", { ZIMAOS_PASSWORD: undefined }],
    ["empty password", { ZIMAOS_PASSWORD: "" }],
  ])("rejects missing credentials (%s)", (_name, overrides) => {
    expect(() => loadConfig(envWith(overrides))).toThrowError(ConfigError);
  });

  it.each([
    ["missing token", { MCP_AUTH_TOKEN: undefined }],
    ["empty token", { MCP_AUTH_TOKEN: "" }],
    ["short token", { MCP_AUTH_TOKEN: "x".repeat(MIN_MCP_TOKEN_LENGTH - 1) }],
  ])("rejects weak or missing MCP_AUTH_TOKEN (%s)", (_name, overrides) => {
    expect(() => loadConfig(envWith(overrides))).toThrowError(ConfigError);
  });

  it("accepts a token at exactly the minimum length", () => {
    const cfg = loadConfig(envWith({ MCP_AUTH_TOKEN: "y".repeat(MIN_MCP_TOKEN_LENGTH) }));
    expect(cfg.mcpAuthToken).toHaveLength(MIN_MCP_TOKEN_LENGTH);
  });

  it.each([
    ["invalid boolean", { ALLOW_APP_CONTROL: "maybe" }],
    ["invalid install flag", { ALLOW_APP_INSTALL: "maybe" }],
    ["invalid uninstall flag", { ALLOW_APP_UNINSTALL: "maybe" }],
    ["invalid edit flag", { ALLOW_APP_EDIT: "maybe" }],
    ["invalid port", { PORT: "99999" }],
    ["non-numeric port", { PORT: "abc" }],
    ["invalid log level", { LOG_LEVEL: "verbose" }],
  ])("rejects malformed optional values (%s)", (_name, overrides) => {
    expect(() => loadConfig(envWith(overrides))).toThrowError(ConfigError);
  });

  it("parses valid optional values", () => {
    const cfg = loadConfig(
      envWith({ ALLOW_APP_CONTROL: "true", PORT: "8080", LOG_LEVEL: "debug" }),
    );
    expect(cfg.allowAppControl).toBe(true);
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe("debug");
  });

  it("parses ALLOW_APP_INSTALL independently of ALLOW_APP_CONTROL", () => {
    const cfg = loadConfig(envWith({ ALLOW_APP_INSTALL: "true" }));
    expect(cfg.allowAppInstall).toBe(true);
    expect(cfg.allowAppControl).toBe(false); // control flag untouched by install flag

    const bothOn = loadConfig(
      envWith({ ALLOW_APP_CONTROL: "true", ALLOW_APP_INSTALL: "true" }),
    );
    expect(bothOn.allowAppControl).toBe(true);
    expect(bothOn.allowAppInstall).toBe(true);
  });

  it("parses ALLOW_APP_UNINSTALL independently of control and install flags", () => {
    // Uninstall enabled alone: neither other flag is implied.
    const uninstallOnly = loadConfig(envWith({ ALLOW_APP_UNINSTALL: "true" }));
    expect(uninstallOnly.allowAppUninstall).toBe(true);
    expect(uninstallOnly.allowAppControl).toBe(false);
    expect(uninstallOnly.allowAppInstall).toBe(false);

    // Control + install enabled: uninstall stays off (no implication either way).
    const controlAndInstall = loadConfig(
      envWith({ ALLOW_APP_CONTROL: "true", ALLOW_APP_INSTALL: "true" }),
    );
    expect(controlAndInstall.allowAppUninstall).toBe(false);

    // All three on together.
    const allOn = loadConfig(
      envWith({
        ALLOW_APP_CONTROL: "true",
        ALLOW_APP_INSTALL: "true",
        ALLOW_APP_UNINSTALL: "true",
      }),
    );
    expect(allOn.allowAppControl).toBe(true);
    expect(allOn.allowAppInstall).toBe(true);
    expect(allOn.allowAppUninstall).toBe(true);

    // Explicit false wins over the other flags being on.
    const explicitOff = loadConfig(
      envWith({
        ALLOW_APP_CONTROL: "true",
        ALLOW_APP_INSTALL: "true",
        ALLOW_APP_UNINSTALL: "false",
      }),
    );
    expect(explicitOff.allowAppUninstall).toBe(false);
  });

  it("never includes secret values in error messages", () => {
    const secret = "super-secret-password-123";
    try {
      loadConfig(envWith({ ZIMAOS_PASSWORD: "" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
