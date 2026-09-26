/**
 * System domain service: normalized ZimaOS device/system summary.
 */

import type { ZimaOsClient } from "./client.js";
import { normalizeSystemInfo, type SystemInfo } from "../domain/models.js";

export class SystemService {
  constructor(private readonly client: ZimaOsClient) {}

  /** Small normalized system summary (Phase 1 scope; not full hardware mgmt). */
  async getSystemInfo(): Promise<SystemInfo> {
    const raw = await this.client.getDeviceInfo();
    return normalizeSystemInfo(raw);
  }
}
