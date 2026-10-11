import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { PermissionLayer } from "../src/permissions.js";

const environment = {
  ZIMAOS_URL: "http://192.0.2.50",
  ZIMAOS_USERNAME: "test-user",
  ZIMAOS_PASSWORD: "synthetic-password",
  MCP_AUTH_TOKEN: "a".repeat(48),
};

describe("system control configuration", () => {
  it("requires its own explicit grant in both configuration and permission layer", () => {
    const enabled = loadConfig({ ...environment, ALLOW_SYSTEM_CONTROL: "true" });
    expect(enabled.allowSystemControl).toBe(true);
    const layer = new PermissionLayer({
      allowAppControl: false,
      allowSystemControl: true,
    });
    expect(() => layer.assertCanRestartDevice()).not.toThrow();
    expect(layer.canControlApps()).toBe(false);
    expect(layer.canInstallApps()).toBe(false);
    expect(layer.canEditApps()).toBe(false);
    expect(layer.canUninstallApps()).toBe(false);
    const denied = new PermissionLayer({
      allowAppControl: true,
      allowAppInstall: true,
      allowAppEdit: true,
      allowAppUninstall: true,
    });
    expect(() => denied.assertCanRestartDevice()).toThrowError(
      "Device restart is disabled. Set ALLOW_SYSTEM_CONTROL=true to enable it.",
    );
    expect(() =>
      loadConfig({ ...environment, ALLOW_SYSTEM_CONTROL: "synthetic-secret" }),
    ).toThrowError(
      "Invalid boolean value for ALLOW_SYSTEM_CONTROL: expected true/false/1/0/yes/no.",
    );
  });
  it("defaults system control off independently of every app permission", () => {
    const config = loadConfig({
      ...environment,
      ALLOW_APP_CONTROL: "true",
      ALLOW_APP_INSTALL: "true",
      ALLOW_APP_UNINSTALL: "true",
      ALLOW_APP_EDIT: "true",
    });
    expect(config.allowSystemControl).toBe(false);
  });
});
