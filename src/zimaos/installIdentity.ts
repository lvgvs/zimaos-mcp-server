/**
 * Install identity assertion (pure utility).
 *
 * The user must supply an explicit top-level compose name for install; unnamed
 * documents are rejected here even though validation (`AppService.validateCompose`)
 * still allows them. The name is used verbatim as the Docker project name, so it
 * must be a conservative safe identifier: no normalization or silent rewriting —
 * anything that does not match exactly is rejected with INPUT_INVALID.
 *
 * Collisions against an existing app id or display name are reported as
 * ZIMAOS_BAD_REQUEST (the host would reject the install anyway). All messages
 * are fixed and sanitized; input content is never echoed back to MCP clients.
 */

import { AppError } from "../errors.js";

/**
 * Conservative Docker project-style safe identifier: starts with a lowercase
 * ASCII letter, then only lowercase letters, digits, underscores, or hyphens;
 * at most 63 characters (Docker's project-name limit).
 */
const SAFE_NAME = /^[a-z][a-z0-9_-]{0,62}$/;

/** Fixed sanitized message: missing/blank name. Never echoes input. */
const MISSING_MESSAGE = "A top-level compose name is required for install.";

/** Fixed sanitized message: unsafe identifier characters or length. */
const UNSAFE_MESSAGE =
  "The compose name must be a safe identifier: start with a lowercase letter, then only lowercase letters, digits, underscores, or hyphens; maximum 63 characters.";

/** Fixed sanitized message: identity already taken on the host. */
const DUPLICATE_MESSAGE = "An application with this identity already exists on the host.";

export interface InstallIdentityApp {
  id: string;
  name?: string;
}

/**
 * Assert that an explicit install identity is present, safe, and unique among
 * existing apps. Returns the name exactly as given when valid.
 *
 * - missing/blank or unsafe identifier -> AppError INPUT_INVALID (fixed message)
 * - collision with any app id or display name (case-insensitive) ->
 *   AppError ZIMAOS_BAD_REQUEST (fixed message)
 */
export function assertInstallIdentity(
  name: string | undefined,
  apps: readonly InstallIdentityApp[],
): string {
  if (name === undefined || name.trim().length === 0) {
    throw new AppError("INPUT_INVALID", MISSING_MESSAGE);
  }

  if (!SAFE_NAME.test(name)) {
    throw new AppError("INPUT_INVALID", UNSAFE_MESSAGE);
  }

  const candidate = name.toLowerCase();
  for (const app of apps) {
    if (
      app.id.toLowerCase() === candidate ||
      (app.name ?? "").toLowerCase() === candidate
    ) {
      throw new AppError("ZIMAOS_BAD_REQUEST", DUPLICATE_MESSAGE);
    }
  }

  return name;
}
