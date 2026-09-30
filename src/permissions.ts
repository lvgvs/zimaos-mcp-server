/**
 * Permission / safety layer.
 *
 * Sits between the MCP tool layer and the ZimaOS API client (AGENTS.md required
 * architecture). Phase 2 has three independent policies: application-control
 * operations are disabled unless explicitly enabled via ALLOW_APP_CONTROL,
 * application-install operations are disabled unless explicitly enabled via
 * ALLOW_APP_INSTALL, and application-uninstall operations are disabled unless
 * explicitly enabled via ALLOW_APP_UNINSTALL. Read-only tools do not consult
 * this layer.
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
  /**
   * When false (default) all application uninstall operations are denied.
   * Independent of allowAppControl and allowAppInstall: enabling either does
   * not enable this one. Omitting it applies the safe default-off value.
   */
  allowAppUninstall?: boolean;
}

export class PermissionLayer {
  private readonly allowAppControl: boolean;
  private readonly allowAppInstall: boolean;
  private readonly allowAppUninstall: boolean;

  constructor(options: PermissionLayerOptions) {
    this.allowAppControl = options.allowAppControl;
    this.allowAppInstall = options.allowAppInstall ?? false;
    this.allowAppUninstall = options.allowAppUninstall ?? false;
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

  /** True when application-uninstall operations are permitted. */
  canUninstallApps(): boolean {
    return this.allowAppUninstall;
  }

  /**
   * Assert that an application-uninstall operation is allowed. Throws a
   * normalized error (never a silent no-op) when uninstall is disabled, per
   * PROJECT.md. Independent of the control and install permissions: enabling
   * either does not enable this one.
   */
  assertCanUninstall(action: string): void {
    if (!this.allowAppUninstall) {
      throw new AppError(
        "APP_UNINSTALL_DISABLED",
        `Application uninstall ("${action}") is disabled. Set ALLOW_APP_UNINSTALL=true to enable it.`,
      );
    }
  }
}
