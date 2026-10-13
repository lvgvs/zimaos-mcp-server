import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import { AppService } from "../src/zimaos/appService.js";
import type { ZimaOsClient } from "../src/zimaos/client.js";

function harness(read: () => Promise<unknown>) {
  const probeComposeAppHealth = vi.fn(async () => ({ state: "unknown" as const }));
  const getComposeAppContainers = vi.fn(read);
  const service = new AppService({
    probeComposeAppHealth,
    getComposeAppContainers,
  } as unknown as ZimaOsClient);
  return { service, probeComposeAppHealth, getComposeAppContainers };
}

describe("application health container-read disclosure", () => {
  it("distinguishes successful empty inventory from a failed read", async () => {
    const h = harness(async () => ({ containers: {} }));
    expect(await h.service.getAppHealth("sample")).toEqual({
      app: "sample",
      probe: { state: "unknown" },
      containers: [],
      containersReadStatus: "succeeded",
    });
    expect(h.probeComposeAppHealth).toHaveBeenCalledExactlyOnceWith("sample");
    expect(h.getComposeAppContainers).toHaveBeenCalledExactlyOnceWith("sample");
  });

  it("preserves normalized container fields and declared roles on success", async () => {
    const h = harness(async () => ({
      main: "web",
      containers: { web: { ID: "sample-web", Service: "web", State: "running" } },
    }));
    expect(await h.service.getAppHealth("sample")).toMatchObject({
      containersReadStatus: "succeeded",
      containers: [
        { id: "sample-web", service: "web", state: "running", isMainService: true },
      ],
    });
  });

  it.each(["PERMISSION_DENIED", "ZIMAOS_UNREACHABLE", "ZIMAOS_AUTH_FAILED"] as const)(
    "returns only the normalized %s code for a failed read",
    async (code) => {
      const h = harness(async () => {
        throw new AppError(code, "private-upstream-message");
      });
      const result = await h.service.getAppHealth("sample");
      expect(result).toEqual({
        app: "sample",
        probe: { state: "unknown" },
        containers: [],
        containersReadStatus: "failed",
        containersReadErrorCode: code,
      });
      expect(JSON.stringify(result)).not.toContain("private-upstream-message");
      expect(h.getComposeAppContainers).toHaveBeenCalledTimes(1);
    },
  );

  it("does not disclose unknown error messages or arbitrary code properties", async () => {
    const h = harness(async () => {
      throw Object.assign(new Error("private-stack-message"), { code: "private-code" });
    });
    expect(await h.service.getAppHealth("sample")).toEqual({
      app: "sample",
      probe: { state: "unknown" },
      containers: [],
      containersReadStatus: "failed",
      containersReadErrorCode: "INTERNAL",
    });
  });

  it("also marks normalization exceptions as failed without returning their text", async () => {
    const h = harness(async () => ({
      get containers(): never {
        throw new Error("private-getter-message");
      },
    }));
    expect(await h.service.getAppHealth("sample")).toMatchObject({
      containers: [],
      containersReadStatus: "failed",
      containersReadErrorCode: "INTERNAL",
    });
  });

  it("does not swallow probe rejections", async () => {
    const h = harness(async () => ({ containers: {} }));
    const error = new AppError("ZIMAOS_UNREACHABLE", "probe failed");
    h.probeComposeAppHealth.mockRejectedValueOnce(error);
    await expect(h.service.getAppHealth("sample")).rejects.toBe(error);
  });
});
