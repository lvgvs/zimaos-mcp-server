import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { assertInstallIdentity } from "../src/zimaos/installIdentity.js";

/**
 * Deterministic tests for the install identity assertion
 * (`src/zimaos/installIdentity.ts`).
 *
 * Every rejection asserts the exact sanitized message. The utility must never
 * echo input content in thrown messages, so an exact-match assertion also pins
 * the no-echo guarantee: any source-derived text would break it.
 */

const MISSING = "A top-level compose name is required for install.";
const UNSAFE =
  "The compose name must be a safe identifier: start with a lowercase letter, then only lowercase letters, digits, underscores, or hyphens; maximum 63 characters.";
const DUPLICATE = "An application with this identity already exists on the host.";

type AppLike = { id: string; name?: string };

function expectRejected(
  name: string | undefined,
  apps: readonly AppLike[],
  code: string,
  message: string,
): void {
  let caught: unknown = null;
  try {
    assertInstallIdentity(name, apps);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  const appError = caught as AppError;
  expect(appError.code).toBe(code);
  // Exact match also pins the no-echo guarantee.
  expect(appError.message).toBe(message);
}

describe("missing or blank names", () => {
  it("rejects an undefined name with INPUT_INVALID", () => {
    expectRejected(undefined, [], "INPUT_INVALID", MISSING);
  });

  it("rejects an empty string name with INPUT_INVALID", () => {
    expectRejected("", [{ id: "other" }], "INPUT_INVALID", MISSING);
  });

  it("rejects a whitespace-only name with INPUT_INVALID", () => {
    expectRejected("   \t\n ", [], "INPUT_INVALID", MISSING);
  });
});

describe("valid names are returned exactly", () => {
  it("returns the name unchanged when there is no collision", () => {
    const apps: AppLike[] = [{ id: "other-app", name: "Other App" }, { id: "second" }];
    expect(assertInstallIdentity("my-app_2", apps)).toBe("my-app_2");
  });

  it("returns a single-letter name unchanged", () => {
    expect(assertInstallIdentity("a", [])).toBe("a");
  });

  it("returns the maximum-length (63 char) name unchanged", () => {
    const name = "a" + "b".repeat(62);
    expect(name.length).toBe(63);
    expect(assertInstallIdentity(name, [])).toBe(name);
  });

  it("accepts a name that differs from an app id only by length", () => {
    const apps: AppLike[] = [{ id: "myapp2" }];
    expect(assertInstallIdentity("myapp", apps)).toBe("myapp");
  });
});

describe("duplicate identity", () => {
  it("rejects a name equal to an existing app id with ZIMAOS_BAD_REQUEST", () => {
    const apps: AppLike[] = [{ id: "my-app_2" }];
    expectRejected("my-app_2", apps, "ZIMAOS_BAD_REQUEST", DUPLICATE);
  });

  it("rejects a name equal to an existing display name with ZIMAOS_BAD_REQUEST", () => {
    const apps: AppLike[] = [{ id: "some-id", name: "MyApp" }];
    expectRejected("myapp", apps, "ZIMAOS_BAD_REQUEST", DUPLICATE);
  });

  it("rejects a collision with any app in the list, not just the first", () => {
    const apps: AppLike[] = [
      { id: "first" },
      { id: "second", name: "Second" },
      { id: "third" },
    ];
    expectRejected("second", apps, "ZIMAOS_BAD_REQUEST", DUPLICATE);
  });
});

describe("case-insensitive collision", () => {
  it("treats an app id as a case-insensitive match", () => {
    const apps: AppLike[] = [{ id: "MYAPP" }];
    expectRejected("myapp", apps, "ZIMAOS_BAD_REQUEST", DUPLICATE);
  });

  it("treats a display name as a case-insensitive match", () => {
    const apps: AppLike[] = [{ id: "some-id", name: "mYaPp" }];
    expectRejected("myapp", apps, "ZIMAOS_BAD_REQUEST", DUPLICATE);
  });

  it("does not collide when only the case differs from a distinct identity", () => {
    const apps: AppLike[] = [{ id: "other" }];
    expect(assertInstallIdentity("myapp", apps)).toBe("myapp");
  });
});

describe("invalid characters", () => {
  it.each([
    ["uppercase letter", "MyApp"],
    ["space", "my app"],
    ["dot", "my.app"],
    ["leading digit", "1myapp"],
    ["leading hyphen", "-myapp"],
    ["leading underscore", "_myapp"],
    ["trailing space", "myapp "],
    ["exclamation mark", "myapp!"],
    ["unicode letter", "müapp"],
    ["control character", "my\x01app"],
  ])("rejects %s with INPUT_INVALID and no source echo", (_label, name) => {
    expectRejected(name, [], "INPUT_INVALID", UNSAFE);
  });

  it("rejects a name longer than 63 characters with INPUT_INVALID", () => {
    const name = "a" + "b".repeat(63); // 64 chars
    expectRejected(name, [], "INPUT_INVALID", UNSAFE);
  });

  it("checks format before collisions: invalid and colliding is still INPUT_INVALID", () => {
    const apps: AppLike[] = [{ id: "myapp" }];
    expectRejected("MyApp", apps, "INPUT_INVALID", UNSAFE);
  });
});
