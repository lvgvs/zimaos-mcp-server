/**
 * Permission / safety layer.
 *
 * Sits between the MCP tool layer and the ZimaOS API client (AGENTS.md required
 * architecture). Phase 1 has a single policy: application-control operations are
 * disabled unless explicitly enabled via ALLOW_APP_CONTROL. Read-only tools do
 * not consult this layer.
 */

import { AppError } from "./errors.js";

export interface PermissionLayerOptions {
  /** When false (default) all application control tools are denied. */
  allowAppControl: boolean;
}

export class PermissionLayer {
  private readonly allowAppControl: boolean;

  constructor(options: PermissionLayerOptions) {
    this.allowAppControl = options.allowAppControl;
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
}
