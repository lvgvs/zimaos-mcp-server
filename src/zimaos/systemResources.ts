import * as z from "zod";
import { AppError } from "../errors.js";

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percent = z.number().min(0).max(100);
const payload = z.object({
  success: z.union([z.literal(200), z.literal(true)]).optional(),
  data: z.object({
    cpu: z
      .object({
        percent: percent.optional(),
        num: z.number().int().min(1).max(4096).optional(),
      })
      .optional(),
    mem: z
      .object({
        total: bytes.optional(),
        used: bytes.optional(),
        available: bytes.optional(),
        free: bytes.optional(),
        usedPercent: percent.optional(),
      })
      .optional(),
    sys_disk: z
      .object({ size: bytes.optional(), used: bytes.optional(), avail: bytes.optional() })
      .optional(),
  }),
});

export interface SystemResources {
  cpu?: { utilizationPercent?: number; logicalProcessors?: number };
  memory?: {
    totalBytes?: number;
    usedBytes?: number;
    availableBytes?: number;
    freeBytes?: number;
    usedPercent?: number;
  };
  systemStorage?: { totalBytes?: number; usedBytes?: number; availableBytes?: number };
}

/** Project numeric evidence only; missing metrics are omitted, not healthy/zero. */
export function normalizeSystemResources(raw: unknown): SystemResources {
  const parsed = payload.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      "ZIMAOS_UPSTREAM_ERROR",
      "The system resource response is malformed.",
    );
  }
  const { cpu, mem, sys_disk: disk } = parsed.data.data;
  if (
    (mem?.total !== undefined &&
      [mem.used, mem.available, mem.free].some(
        (value) => value !== undefined && value > mem.total!,
      )) ||
    (disk?.size !== undefined &&
      [disk.used, disk.avail].some((value) => value !== undefined && value > disk.size!))
  ) {
    throw new AppError(
      "ZIMAOS_UPSTREAM_ERROR",
      "The system resource response is malformed.",
    );
  }
  const result: SystemResources = {};
  if (cpu) {
    result.cpu = {};
    if (cpu.percent !== undefined) result.cpu.utilizationPercent = cpu.percent;
    if (cpu.num !== undefined) result.cpu.logicalProcessors = cpu.num;
  }
  if (mem) {
    result.memory = {};
    if (mem.total !== undefined) result.memory.totalBytes = mem.total;
    if (mem.used !== undefined) result.memory.usedBytes = mem.used;
    if (mem.available !== undefined) result.memory.availableBytes = mem.available;
    if (mem.free !== undefined) result.memory.freeBytes = mem.free;
    if (mem.usedPercent !== undefined) result.memory.usedPercent = mem.usedPercent;
  }
  if (disk) {
    result.systemStorage = {};
    if (disk.size !== undefined) result.systemStorage.totalBytes = disk.size;
    if (disk.used !== undefined) result.systemStorage.usedBytes = disk.used;
    if (disk.avail !== undefined) result.systemStorage.availableBytes = disk.avail;
  }
  if (result.cpu && Object.keys(result.cpu).length === 0) delete result.cpu;
  if (result.memory && Object.keys(result.memory).length === 0) delete result.memory;
  if (result.systemStorage && Object.keys(result.systemStorage).length === 0)
    delete result.systemStorage;
  return result;
}
