import { describe, expect, it } from "vitest";
import { ZimaOsClient } from "../src/zimaos/client.js";

const source =
  "name: example-native\nservices:\n  main:\n    image: example/image:latest\n";
function fixture(
  status = 200,
  message = "app is being installed asynchronously",
  failure = false,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new ZimaOsClient({
    baseUrl: "http://example.test",
    username: "test",
    password: "synthetic",
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/users/login"))
        return Response.json({
          success: true,
          data: {
            token: {
              access_token: "synthetic-token",
              refresh_token: "synthetic-refresh",
            },
          },
        });
      if (failure) throw new Error("SYNTHETIC_SECRET");
      return Response.json({ message }, { status });
    },
  });
  return { client, calls };
}

describe("explicit controlled native installation client", () => {
  it("also prevents redirect-driven retransmission on the shared Compose install/edit paths", async () => {
    for (const action of ["install", "edit", "validate", "validate-edit"] as const) {
      const { client, calls } = fixture();
      if (action === "install") await client.installComposeOnce(source);
      else if (action === "edit")
        await client.applyComposeChangeOnce("example-native", source);
      else if (action === "validate") await client.validateCompose(source);
      else await client.validateComposeChange("example-native", source);
      expect(calls[1]?.init?.redirect).toBe("error");
    }
  });
  it("submits final bytes exactly once with controlled native options and reports only async acceptance", async () => {
    const { client, calls } = fixture();
    expect(client.installNativeStoreComposeOnce).toBeTypeOf("function");
    expect(await client.installNativeStoreComposeOnce(source)).toEqual({
      status: "accepted",
      accepted: true,
    });
    const mutation = calls.filter((c) => !c.url.endsWith("/v1/users/login"));
    expect(mutation).toHaveLength(1);
    expect(mutation[0]?.url).toBe(
      "http://example.test/v2/app_management/compose?dry_run=false&check_port_conflict=true&uncontrolled=false",
    );
    expect(mutation[0]?.init).toMatchObject({
      method: "POST",
      body: source,
      redirect: "error",
      headers: { "Content-Type": "application/yaml" },
    });
  });

  it.each([401, 403, 429])(
    "never reauthenticates or retries a real native POST after HTTP %i",
    async (status) => {
      const { client, calls } = fixture(status);
      await expect(client.installNativeStoreComposeOnce(source)).rejects.toThrow();
      expect(calls).toHaveLength(2); // one login, one mutation
    },
  );

  it.each([
    [400, "rejected"],
    [503, "upstream_error"],
  ] as const)("normalizes HTTP %i without a second mutation", async (status, outcome) => {
    const { client, calls } = fixture(status);
    expect(await client.installNativeStoreComposeOnce(source)).toEqual({
      status: outcome,
      accepted: false,
    });
    expect(calls).toHaveLength(2);
  });

  it("does not retry an unknown acceptance envelope or transport failure", async () => {
    const uncertain = fixture(200, "SYNTHETIC_SECRET");
    expect(await uncertain.client.installNativeStoreComposeOnce(source)).toEqual({
      status: "upstream_error",
      accepted: false,
    });
    expect(uncertain.calls).toHaveLength(2);
    const disconnected = fixture(200, "", true);
    await expect(
      disconnected.client.installNativeStoreComposeOnce(source),
    ).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
    expect(disconnected.calls).toHaveLength(2);
  });
  it("validates final bytes with fixed native query and cannot follow a POST redirect", async () => {
    const { client, calls } = fixture();
    expect(client.validateNativeStoreCompose).toBeTypeOf("function");
    expect(await client.validateNativeStoreCompose(source)).toMatchObject({
      status: "accepted",
      accepted: true,
    });
    const validation = calls.filter((c) => !c.url.endsWith("/v1/users/login"));
    expect(validation).toHaveLength(1);
    expect(validation[0]?.url).toBe(
      "http://example.test/v2/app_management/compose?dry_run=true&check_port_conflict=true&uncontrolled=false",
    );
    expect(validation[0]?.init).toMatchObject({
      method: "POST",
      body: source,
      redirect: "error",
      headers: { "Content-Type": "application/yaml" },
    });
  });
});
