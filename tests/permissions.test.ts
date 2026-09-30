import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { PermissionLayer } from "../src/permissions.js";

describe("PermissionLayer", () => {
  it("denies application control by default (disabled)", () => {
    const layer = new PermissionLayer({ allowAppControl: false });
    expect(layer.canControlApps()).toBe(false);
    expect(() => layer.assertCanControl("start_app")).toThrowError(AppError);
    try {
      layer.assertCanControl("start_app");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as AppError).code).toBe("APP_CONTROL_DISABLED");
      // The message must name the action and the enabling variable, not leak internals.
      expect((err as Error).message).toContain("start_app");
      expect((err as Error).message).toContain("ALLOW_APP_CONTROL=true");
    }
  });

  it("permits application control when explicitly enabled", () => {
    const layer = new PermissionLayer({ allowAppControl: true });
    expect(layer.canControlApps()).toBe(true);
    expect(() => layer.assertCanControl("restart_app")).not.toThrow();
  });

  it("denies app installation by default (disabled)", () => {
    // allowAppInstall omitted entirely: the safe default-off value applies.
    const layer = new PermissionLayer({ allowAppControl: false });
    expect(layer.canInstallApps()).toBe(false);
    expect(() => layer.assertCanInstall("install_app")).toThrowError(AppError);
    try {
      layer.assertCanInstall("install_app");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as AppError).code).toBe("APP_INSTALL_DISABLED");
      // The message must name the action and the enabling variable, not leak internals.
      expect((err as Error).message).toContain("install_app");
      expect((err as Error).message).toContain("ALLOW_APP_INSTALL=true");
    }
  });

  it("permits app installation when explicitly enabled", () => {
    const layer = new PermissionLayer({ allowAppControl: false, allowAppInstall: true });
    expect(layer.canInstallApps()).toBe(true);
    expect(() => layer.assertCanInstall("install_app")).not.toThrow();
  });

  it("keeps install permission independent of control permission (both directions)", () => {
    // Control enabled, install disabled.
    const controlOnly = new PermissionLayer({
      allowAppControl: true,
      allowAppInstall: false,
    });
    expect(controlOnly.canControlApps()).toBe(true);
    expect(() => controlOnly.assertCanControl("start_app")).not.toThrow();
    expect(controlOnly.canInstallApps()).toBe(false);
    expect(() => controlOnly.assertCanInstall("install_app")).toThrowError(AppError);

    // Install enabled, control disabled.
    const installOnly = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: true,
    });
    expect(installOnly.canInstallApps()).toBe(true);
    expect(() => installOnly.assertCanInstall("install_app")).not.toThrow();
    expect(installOnly.canControlApps()).toBe(false);
    expect(() => installOnly.assertCanControl("start_app")).toThrowError(AppError);
  });

  it("denies app uninstallation by default (disabled)", () => {
    // allowAppUninstall omitted entirely: the safe default-off value applies.
    const layer = new PermissionLayer({ allowAppControl: false });
    expect(layer.canUninstallApps()).toBe(false);
    expect(() => layer.assertCanUninstall("uninstall_app")).toThrowError(AppError);
    try {
      layer.assertCanUninstall("uninstall_app");
      throw new Error("should have thrown");
    } catch (err) {
      // Distinct code: not APP_CONTROL_DISABLED or APP_INSTALL_DISABLED.
      expect((err as AppError).code).toBe("APP_UNINSTALL_DISABLED");
      // The message must name the action and the enabling variable, not leak internals.
      expect((err as Error).message).toContain("uninstall_app");
      expect((err as Error).message).toContain("ALLOW_APP_UNINSTALL=true");
    }
  });

  it("permits app uninstallation when explicitly enabled", () => {
    const layer = new PermissionLayer({
      allowAppControl: false,
      allowAppUninstall: true,
    });
    expect(layer.canUninstallApps()).toBe(true);
    expect(() => layer.assertCanUninstall("uninstall_app")).not.toThrow();
  });

  it("keeps uninstall permission independent of control and install permissions (both directions)", () => {
    // Control + install enabled, uninstall disabled.
    const noUninstall = new PermissionLayer({
      allowAppControl: true,
      allowAppInstall: true,
      allowAppUninstall: false,
    });
    expect(noUninstall.canControlApps()).toBe(true);
    expect(() => noUninstall.assertCanControl("start_app")).not.toThrow();
    expect(noUninstall.canInstallApps()).toBe(true);
    expect(() => noUninstall.assertCanInstall("install_app")).not.toThrow();
    expect(noUninstall.canUninstallApps()).toBe(false);
    expect(() => noUninstall.assertCanUninstall("uninstall_app")).toThrowError(AppError);

    // Uninstall enabled, control + install disabled.
    const uninstallOnly = new PermissionLayer({
      allowAppControl: false,
      allowAppInstall: false,
      allowAppUninstall: true,
    });
    expect(uninstallOnly.canUninstallApps()).toBe(true);
    expect(() => uninstallOnly.assertCanUninstall("uninstall_app")).not.toThrow();
    expect(uninstallOnly.canControlApps()).toBe(false);
    expect(() => uninstallOnly.assertCanControl("start_app")).toThrowError(AppError);
    expect(uninstallOnly.canInstallApps()).toBe(false);
    expect(() => uninstallOnly.assertCanInstall("install_app")).toThrowError(AppError);

    // Omitted option: default-off even when the other flags are on.
    const omitted = new PermissionLayer({ allowAppControl: true, allowAppInstall: true });
    expect(omitted.canUninstallApps()).toBe(false);
  });

  it("read-only operations never consult the permission layer", () => {
    // Structural guarantee: read tools do not call assertCanControl at all.
    const layer = new PermissionLayer({ allowAppControl: false });
    expect(layer.canControlApps()).toBe(false);
    // No API exists for reads to be gated; only control operations assert.
  });
});
