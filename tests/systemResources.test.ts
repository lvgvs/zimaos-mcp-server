import { describe, expect, it } from "vitest";
import { normalizeSystemResources } from "../src/zimaos/systemResources.js";

describe("system resource projection", () => {
  it.each([
    { data: { mem: { total: 100, used: 101 } } },
    { data: { mem: { total: 100, available: 101 } } },
    { data: { mem: { total: 100, free: 101 } } },
    { data: { sys_disk: { size: 100, used: 101 } } },
    { data: { sys_disk: { size: 100, avail: 101 } } },
  ])("rejects counters exceeding their reported total: %j", (raw) => {
    expect(() => normalizeSystemResources(raw)).toThrow(
      "The system resource response is malformed.",
    );
  });
  it("omits empty metric groups", () => {
    expect(
      normalizeSystemResources({
        data: { cpu: { temperature: 0 }, mem: {}, sys_disk: { health: true } },
      }),
    ).toEqual({});
  });
  it("omits unavailable metrics without zero or healthy defaults", () => {
    expect(normalizeSystemResources({ success: 200, data: {} })).toEqual({});
    expect(normalizeSystemResources({ data: { cpu: { num: 2 } } })).toEqual({
      cpu: { logicalProcessors: 2 },
    });
  });

  it.each([
    null,
    { success: false, data: {} },
    { success: 500, data: {} },
    { data: null },
    { data: [] },
    { data: { cpu: { percent: "0" } } },
    { data: { cpu: { percent: -1 } } },
    { data: { cpu: { percent: 101 } } },
    { data: { cpu: { percent: NaN } } },
    { data: { cpu: { percent: Infinity } } },
    { data: { cpu: { num: 0 } } },
    { data: { cpu: { num: 4097 } } },
    { data: { mem: { total: -1 } } },
    { data: { mem: { total: 0.5 } } },
    { data: { mem: { usedPercent: 101 } } },
    { data: { sys_disk: { size: Number.MAX_SAFE_INTEGER + 1 } } },
  ])("rejects malformed critical numeric/envelope evidence: %j", (raw) => {
    expect(() => normalizeSystemResources(raw)).toThrow(
      "The system resource response is malformed.",
    );
  });

  it("projects sampled CPU, memory and system-storage metrics only", () => {
    expect(
      normalizeSystemResources({
        success: 200,
        data: {
          cpu: { percent: 0, num: 2, temperature: 0, power: "untrusted" },
          mem: { total: 100, used: 0, free: 20, available: 80, usedPercent: 0 },
          sys_disk: { size: 1000, used: 0, avail: 900, health: true },
          net: [{ name: "must-not-be-returned" }],
        },
      }),
    ).toEqual({
      cpu: { utilizationPercent: 0, logicalProcessors: 2 },
      memory: {
        totalBytes: 100,
        usedBytes: 0,
        freeBytes: 20,
        availableBytes: 80,
        usedPercent: 0,
      },
      systemStorage: { totalBytes: 1000, usedBytes: 0, availableBytes: 900 },
    });
  });
});
