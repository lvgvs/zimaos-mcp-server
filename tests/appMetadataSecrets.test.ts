import { describe, expect, it } from "vitest";
import { AppService } from "../src/zimaos/appService.js";
import { ZimaOsClient } from "../src/zimaos/client.js";

const password = "synthetic-credential-Ω";
const token = "synthetic-access-token";
describe("new installed-app metadata credential exclusion", () => {
  it.each([
    password,
    encodeURIComponent(password),
    token,
    Array.from(Buffer.from(token), (b) => "%" + b.toString(16).padStart(2, "0")).join(""),
  ])(
    "does not return a configured credential in a newly resolved localized title",
    async (unsafe) => {
      const client = new ZimaOsClient({
        baseUrl: "http://zimaos.test",
        username: "synthetic-user",
        password,
        fetchImpl: async (input) =>
          new Response(
            JSON.stringify(
              String(input).endsWith("/v1/users/login")
                ? { success: true, data: { token: { access_token: token } } }
                : {
                    success: true,
                    data: {
                      sample: {
                        store_info: {
                          title: { en_us: unsafe, en: "Safe Display" },
                          main: token,
                        },
                      },
                    },
                  },
            ),
            { status: 200 },
          ),
      });
      const result = await new AppService(client).getApp("sample");
      expect(result.name).toBe("Safe Display");
      expect(result).not.toHaveProperty("mainService");
      expect(JSON.stringify(result)).not.toContain(password);
      expect(JSON.stringify(result)).not.toContain(token);
    },
  );
});
