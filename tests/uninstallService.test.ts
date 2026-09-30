import { describe, expect, it } from "vitest";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { PermissionLayer } from "../src/permissions.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

const PATH = "/v2/app_management/compose";
const ALLOWED = new PermissionLayer({ allowAppControl: false, allowAppUninstall: true });
const DENIED = new PermissionLayer({ allowAppControl: true, allowAppInstall: true });

function setup(
  id: string,
  apps: Record<string, unknown> = { [id]: { name: id } },
  deleteStatus = 200,
) {
  const fake = new FakeZimaOs();
  fake.on("POST", "/v1/users/login", {
    json: { success: true, data: { token: { access_token: "fake-token" } } },
  });
  fake.ok("GET", PATH, apps);
  fake.on("DELETE", `${PATH}/${id}`, {
    status: deleteStatus,
    json: { success: deleteStatus === 200 },
  });
  const client = new ZimaOsClient({
    baseUrl: "http://zimaos.test",
    username: "admin",
    password: "pw",
    fetchImpl: fake.fetchImpl,
    timeoutMs: 5000,
  });
  const service = new AppService(client);
  const deletes = () => fake.calls.filter((c) => c.method === "DELETE");
  return { fake, service, deletes };
}

describe("AppService.uninstallApp", () => {
  it("denies independently of install/control without any upstream traffic", async () => {
    const h = setup("deny-uninstall");
    await expect(h.service.uninstallApp("deny-uninstall", DENIED)).rejects.toMatchObject({
      code: "APP_UNINSTALL_DISABLED",
    });
    expect(h.fake.calls).toHaveLength(0);
  });

  it("validates explicit safe id before login, list or DELETE", async () => {
    const h = setup("valid-uninstall");
    for (const id of ["", " ", "../other", "id/other", "\n", "a".repeat(129)]) {
      await expect(h.service.uninstallApp(id, ALLOWED)).rejects.toMatchObject({
        code: "INPUT_INVALID",
      });
    }
    expect(h.fake.calls).toHaveLength(0);
  });

  it("requires an exact listed id rather than a display name", async () => {
    const h = setup("missing-id", { "different-id": { name: "missing-id" } });
    await expect(h.service.uninstallApp("missing-id", ALLOWED)).rejects.toMatchObject({
      code: "ZIMAOS_NOT_FOUND",
    });
    expect(h.deletes()).toHaveLength(0);
  });

  it("sends one DELETE, reports asynchronous acceptance and pending stale-list observation", async () => {
    const h = setup("pending-uninstall");
    expect(await h.service.uninstallApp("pending-uninstall", ALLOWED)).toEqual({
      status: "accepted",
      accepted: true,
      reconciliation: "pending",
    });
    expect(h.deletes()).toHaveLength(1);
    expect(
      h.fake.calls.filter((c) => c.method === "GET" && c.path === PATH),
    ).toHaveLength(2);
    await expect(
      h.service.uninstallApp("pending-uninstall", ALLOWED),
    ).rejects.toMatchObject({
      code: "ZIMAOS_BAD_REQUEST",
    });
    expect(h.deletes()).toHaveLength(1);
  });

  it("reports absent only when one read after acceptance observes disappearance", async () => {
    const h = setup("absent-uninstall");
    h.fake.ok("GET", PATH, {});
    expect(await h.service.uninstallApp("absent-uninstall", ALLOWED)).toMatchObject({
      status: "accepted",
      reconciliation: "absent",
    });
    expect(h.deletes()).toHaveLength(1);
  });

  it("a definitive rejection releases the same-id reservation", async () => {
    const h = setup("reject-uninstall", undefined, 404);
    expect(await h.service.uninstallApp("reject-uninstall", ALLOWED)).toEqual({
      status: "rejected",
      accepted: false,
    });
    expect(await h.service.uninstallApp("reject-uninstall", ALLOWED)).toEqual({
      status: "rejected",
      accepted: false,
    });
    expect(h.deletes()).toHaveLength(2);
  });

  it("an ambiguous response retains protection while unrelated ids proceed", async () => {
    const h = setup(
      "uncertain-uninstall",
      {
        "uncertain-uninstall": { name: "uncertain-uninstall" },
        "other-uninstall": { name: "other-uninstall" },
      },
      502,
    );
    h.fake.ok("DELETE", `${PATH}/other-uninstall`, { success: true });
    expect(await h.service.uninstallApp("uncertain-uninstall", ALLOWED)).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    await expect(
      h.service.uninstallApp("uncertain-uninstall", ALLOWED),
    ).rejects.toMatchObject({ code: "ZIMAOS_BAD_REQUEST" });
    expect((await h.service.uninstallApp("other-uninstall", ALLOWED)).status).toBe(
      "accepted",
    );
    expect(h.deletes()).toHaveLength(2);
  });
});
