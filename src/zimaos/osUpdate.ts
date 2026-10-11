import * as z from "zod";
import { AppError } from "../errors.js";

const success = z.union([z.literal(200), z.literal(true)]).optional();
const release = z.object({
  success,
  data: z.object({
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  }),
});
const notice = z.object({
  success,
  data: z.enum(["no-update", "normal-update", "important-update", "force-update"]),
});
const status = z.object({
  success,
  data: z.object({ status: z.enum(["idle", "installing", "installError"]) }),
});
const beta = z.object({
  success,
  data: z.object({ status: z.enum(["enabled", "disabled"]) }),
});
const evidence = z.object({ current: release, latest: release, notice, status, beta });

export interface OsUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  notice: "no-update" | "normal-update" | "important-update" | "force-update";
  /** Upstream notice classification only, not version comparison or install eligibility. */
  updateAvailable: boolean;
  installerStatus: "idle" | "installing" | "installError";
  betaSubscription: "enabled" | "disabled";
}

/** Separate sequential upstream snapshots; idle is not proof of update completion. */
export function normalizeOsUpdateStatus(raw: unknown): OsUpdateStatus {
  const parsed = evidence.safeParse(raw);
  if (!parsed.success)
    throw new AppError("ZIMAOS_UPSTREAM_ERROR", "The OS update response is malformed.");
  const d = parsed.data;
  return {
    currentVersion: d.current.data.version,
    latestVersion: d.latest.data.version,
    notice: d.notice.data,
    updateAvailable: d.notice.data !== "no-update",
    installerStatus: d.status.data.status,
    betaSubscription: d.beta.data.status,
  };
}
