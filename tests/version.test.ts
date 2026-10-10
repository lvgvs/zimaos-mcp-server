import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:module");
  vi.resetModules();
});

it.each([null, {}, { version: 42 }, { version: "" }, { version: "   " }])(
  "rejects malformed package version metadata: %j",
  async (metadata) => {
    vi.resetModules();
    vi.doMock("node:module", () => ({
      createRequire: () => () => metadata,
    }));
    await expect(import("../src/version.js")).rejects.toThrow(
      "Invalid package metadata: version must be a non-empty string.",
    );
  },
);
