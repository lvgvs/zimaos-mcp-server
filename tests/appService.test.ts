import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ZimaOsClient } from "../src/zimaos/client.js";
import { AppService } from "../src/zimaos/appService.js";
import { FakeZimaOs } from "./helpers/fakeZimaOs.js";

/**
 * Focused tests for the non-mutating `AppService.validateCompose` orchestration:
 * parseCompose -> analyzeCompose -> client dry-run, returning a bounded
 * structured result. Local parser/analyzer rejections must short-circuit with
 * no upstream call; validation outcomes (accepted / rejected / ambiguous) are
 * data, not errors; the exact original source reaches the dry run unchanged,
 * exactly once; and nothing is installed or mutated.
 */

const BASE = "http://zimaos.test:8080";
/** The fake records pathname only; routes key on the bare path. */
const DRY_RUN_PATH = "/v2/app_management/compose";
/** Full dry-run URL the client must call (query string included). */
const DRY_RUN_URL = `${BASE}/v2/app_management/compose?dry_run=true&check_port_conflict=true`;

interface Harness {
  fake: FakeZimaOs;
  service: AppService;
  /** Every full request URL sent by the client, in order. */
  urls: string[];
}

function makeHarness(): Harness {
  const fake = new FakeZimaOs();
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return fake.fetchImpl(input, init);
  }) as typeof fetch;
  const client = new ZimaOsClient({
    baseUrl: BASE,
    username: "admin",
    password: "pw",
    fetchImpl,
    timeoutMs: 5_000,
  });
  return { fake, service: new AppService(client), urls };
}

function loginOk(fake: FakeZimaOs): void {
  fake.on("POST", "/v1/users/login", {
    json: {
      success: true,
      message: "ok",
      data: { token: { access_token: "tok-abc", refresh_token: "ref" } },
    },
  });
}

function dryRunCalls(fake: FakeZimaOs) {
  return fake.calls.filter((c) => c.path === DRY_RUN_PATH);
}

describe("AppService.validateCompose (non-mutating, mocked HTTP)", () => {
  it("validates a safe unnamed document and reports accepted with no findings", async () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:alpine",
      "    ports:",
      '      - "8080:80"',
      "",
    ].join("\n");
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

    const result = await h.service.validateCompose(source);

    expect(result.status).toBe("accepted");
    expect(result.accepted).toBe(true);
    expect(result.findings).toEqual([]);
    // No name requirement: an unnamed document validates fine.
    expect(Object.prototype.hasOwnProperty.call(result, "name")).toBe(false);
  });

  it("sends the exact original source unchanged and performs exactly one dry run", async () => {
    const source = [
      "# comment with ${HOME} interpolation marker stays verbatim",
      "services:",
      "  web:",
      "    image: nginx:alpine",
      "",
    ].join("\n");
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

    await h.service.validateCompose(source);

    expect(dryRunCalls(h.fake)).toHaveLength(1);
    expect(dryRunCalls(h.fake)[0]?.body).toBe(source);
    // Exactly one dry-run request, at the documented dry-run URL.
    expect(h.urls.filter((u) => u === DRY_RUN_URL)).toHaveLength(1);
  });

  it("performs no mutation or install: only login and the dry run are called", async () => {
    const source = "services:\n  web:\n    image: nginx\n";
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

    await h.service.validateCompose(source);

    expect([...new Set(h.fake.calls.map((c) => c.path))].sort()).toEqual(
      ["/v1/users/login", DRY_RUN_PATH].sort(),
    );
  });

  it("reports risky findings from the local analyzer and still runs the dry run once", async () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    privileged: true",
      "    network_mode: host",
      "    volumes:",
      '      - "/var/run/docker.sock:/docker"',
      "",
    ].join("\n");
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, { json: { success: true } });

    const result = await h.service.validateCompose(source);

    expect(result.findings.map((f) => f.category)).toEqual([
      "privileged",
      "host_network_mode",
      "docker_socket",
    ]);
    for (const finding of result.findings) {
      expect(finding.service).toBe("web");
      expect(typeof finding.field).toBe("string");
      expect(typeof finding.description).toBe("string");
    }
    expect(result.status).toBe("accepted");
    expect(dryRunCalls(h.fake)).toHaveLength(1);
  });

  it("fails closed before contacting upstream when findings exceed the output budget", async () => {
    const h = makeHarness();
    const services = Array.from(
      { length: 257 },
      (_, i) => `  s${i}:\n    privileged: true`,
    ).join("\n");
    await expect(
      h.service.validateCompose(`services:\n${services}\n`),
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(h.fake.calls).toHaveLength(0);
  });

  it("rejects a local parser failure without any upstream call", async () => {
    const h = makeHarness();
    loginOk(h.fake);

    await expect(
      h.service.validateCompose("services:\n  web: [unclosed\n"),
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: "compose parse failed: YAML syntax error",
    });

    // The client was never touched: no login, no dry run.
    expect(h.fake.calls).toHaveLength(0);
  });

  it("rejects a local analyzer failure without any upstream call", async () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx",
      "    network_mode: ${MODE}",
      "",
    ].join("\n");
    const h = makeHarness();
    loginOk(h.fake);

    await expect(h.service.validateCompose(source)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: "compose analyze failed: interpolation in checked field",
    });

    expect(dryRunCalls(h.fake)).toHaveLength(0);
  });

  it("returns upstream rejection as data without leaking upstream text", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, {
      status: 400,
      json: { success: false, message: "SECRET-UPSTREAM-TEXT" },
    });

    const result = await h.service.validateCompose(
      "services:\n  web:\n    image: nginx\n",
    );

    expect(result.status).toBe("rejected");
    expect(result.accepted).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET-UPSTREAM-TEXT");
  });

  it("returns bounded ports in use with an upstream rejection", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, {
      status: 400,
      json: { success: false, data: { ports_in_use: [8080, "9090"] } },
    });

    const result = await h.service.validateCompose(
      "services:\n  web:\n    image: nginx\n",
    );

    expect(result.status).toBe("rejected");
    expect(result.portsInUse).toEqual([8080, 9090]);
  });

  it("returns an ambiguous upstream failure as data without leaking text", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, { status: 502, text: "SECRET-UPSTREAM-TEXT" });

    const result = await h.service.validateCompose(
      "services:\n  web:\n    image: nginx\n",
    );

    expect(result.status).toBe("upstream_error");
    expect(result.accepted).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET-UPSTREAM-TEXT");
  });

  it("propagates client transport/auth AppErrors unchanged", async () => {
    const h = makeHarness();
    loginOk(h.fake);
    h.fake.on("POST", DRY_RUN_PATH, {
      error: new AppError(
        "ZIMAOS_UNREACHABLE",
        "Could not reach the ZimaOS host (network error).",
      ),
    });

    await expect(
      h.service.validateCompose("services:\n  web:\n    image: nginx\n"),
    ).rejects.toMatchObject({ code: "ZIMAOS_UNREACHABLE" });
  });
});
