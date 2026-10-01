import { describe, expect, it } from "vitest";
import { ComposeEditService } from "../src/zimaos/composeEdit.js";
import { sourceFingerprint } from "../src/approval/intent.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const endpoint = "/v2/app_management/compose/repair";
const base = "name: repair\nservices:\n  web:\n    image: nginx:alpine\n";
function setup(current = base) {
  const fake = new FakeZimaOs();
  fake.ok("POST", "/v1/users/login", {
    token: { access_token: "local-token", refresh_token: "unused" },
  });
  fake.on("GET", endpoint, { text: current });
  fake.on("PUT", endpoint, { json: { message: "validated" } });
  const client = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "test",
    password: "local-password-value",
    fetchImpl: fake.fetchImpl,
  });
  return { fake, service: new ComposeEditService(client) };
}

describe("ComposeEditService read/validate (mocked API)", () => {
  it("reads an interpolated representation and exact fingerprint", async () => {
    const { service } = setup();
    expect(await service.read("repair")).toEqual({
      app_id: "repair",
      source: base,
      fingerprint: sourceFingerprint(base),
      representation: "interpolated_yaml",
    });
  });

  it("validates the exact proposed bytes without any mutating request", async () => {
    const { service, fake } = setup();
    const next = base.replace("nginx:alpine", "nginx:stable");
    const result = await service.validate("repair", sourceFingerprint(base), next);
    expect(result).toMatchObject({
      baseFingerprint: sourceFingerprint(base),
      proposedFingerprint: sourceFingerprint(next),
      upstream: { accepted: true },
      changes: { changedServices: ["web"] },
      risks: { requiresApproval: false },
    });
    expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(fake.calls.find((call) => call.method === "PUT")?.body).toBe(next);
  });

  it("rejects stale base before any dry-run", async () => {
    const { service, fake } = setup();
    await expect(service.validate("repair", "a".repeat(64), base)).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
    });
    expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("rejects project rename and malformed YAML before upstream PUT", async () => {
    const { service, fake } = setup();
    await expect(
      service.validate(
        "repair",
        sourceFingerprint(base),
        base.replace("name: repair", "name: other"),
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(
      service.validate("repair", sourceFingerprint(base), "name: [broken"),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("flags only new risk and refuses to return an interpolated ZimaOS credential", async () => {
    const { service } = setup();
    const result = await service.validate(
      "repair",
      sourceFingerprint(base),
      base + "    privileged: true\n",
    );
    expect(result.risks.introduced.map((item) => item.category)).toEqual(["privileged"]);
    const protectedApp = setup(
      base + "    environment:\n      ZIMAOS_PASSWORD: test-placeholder\n",
    );
    await expect(protectedApp.service.read("repair")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});
