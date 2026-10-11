/**
 * System domain service: normalized ZimaOS device/system summary.
 */

import type { DeviceRestartResult, ZimaOsClient } from "./client.js";
import { normalizeSystemInfo, type SystemInfo } from "../domain/models.js";
import { normalizeSystemResources, type SystemResources } from "./systemResources.js";
import type { OsUpdateStatus } from "./osUpdate.js";

export class SystemService {
  constructor(private readonly client: ZimaOsClient) {}

  async restartDevice(): Promise<DeviceRestartResult> {
    return this.client.restartDeviceOnce();
  }

  async getOsUpdateStatus(): Promise<OsUpdateStatus> {
    return this.client.getOsUpdateStatus();
  }

  async getSystemResources(): Promise<SystemResources> {
    return normalizeSystemResources(await this.client.getSystemResources());
  }

  /** Small normalized system summary (Phase 1 scope; not full hardware mgmt). */
  async getSystemInfo(): Promise<SystemInfo> {
    const raw = await this.client.getDeviceInfo();
    return normalizeSystemInfo(raw);
  }
}
