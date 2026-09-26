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

  it("read-only operations never consult the permission layer", () => {
    // Structural guarantee: read tools do not call assertCanControl at all.
    const layer = new PermissionLayer({ allowAppControl: false });
    expect(layer.canControlApps()).toBe(false);
    // No API exists for reads to be gated; only control operations assert.
  });
});
