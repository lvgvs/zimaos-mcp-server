import { createRequire } from "node:module";

// Both src/version.ts and dist/version.js are one level below the root package.
const metadata: unknown = createRequire(import.meta.url)("../package.json");
if (
  typeof metadata !== "object" ||
  metadata === null ||
  !("version" in metadata) ||
  typeof metadata.version !== "string" ||
  metadata.version.trim().length === 0
) {
  throw new Error("Invalid package metadata: version must be a non-empty string.");
}

export const VERSION = metadata.version;
