/**
 * Permission / safety layer.
 *
 * Sits between the MCP tool layer and the ZimaOS API client (AGENTS.md required
 * architecture). Phase 2 has two independent policies: application-control
 * operations are disabled unless explicitly enabled via ALLOW_APP_CONTROL, and
 * application-install operations are disabled unless explicitly enabled via
 * ALLOW_APP_INSTALL. Read-only tools do not consult this layer.
 */

import { AppError } from "./errors.js";

export interface PermissionLayerOptions {
  /** When false (default) all application control tools are denied. */
  allowAppControl: boolean;
  /**
   * When false (default) all application install operations are denied.
   * Independent of allowAppControl: enabling one does not enable the other.
   * Omitting it applies the safe default-off value.
   */
  allowAppInstall?: boolean;
}

export class PermissionLayer {
  private readonly allowAppControl: boolean;
  private readonly allowAppInstall: boolean;

  constructor(options: PermissionLayerOptions) {
    this.allowAppControl = options.allowAppControl;
    this.allowAppInstall = options.allowAppInstall ?? false;
  }

  /** True when application-control operations are permitted. */
  canControlApps(): boolean {
    return this.allowAppControl;
  }

  /**
   * Assert that an application-control operation is allowed. Throws a normalized
   * error (never a silent no-op) when control is disabled, per PROJECT.md.
   */
  assertCanControl(action: string): void {
    if (!this.allowAppControl) {
      throw new AppError(
        "APP_CONTROL_DISABLED",
        `Application control ("${action}") is disabled. Set ALLOW_APP_CONTROL=true to enable it.`,
      );
    }
  }

  /** True when application-install operations are permitted. */
  canInstallApps(): boolean {
    return this.allowAppInstall;
  }

  /**
   * Assert that an application-install operation is allowed. Throws a normalized
   * error (never a silent no-op) when install is disabled, per PROJECT.md.
   * Independent of the control permission: enabling one does not enable the other.
   */
  assertCanInstall(action: string): void {
    if (!this.allowAppInstall) {
      throw new AppError(
        "APP_INSTALL_DISABLED",
        `Application install ("${action}") is disabled. Set ALLOW_APP_INSTALL=true to enable it.`,
      );
    }
  }
}
