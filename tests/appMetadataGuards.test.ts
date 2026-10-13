import { describe, expect, it } from "vitest";
import { normalizeAppList, normalizeContainers } from "../src/domain/models.js";

describe("explicit record metadata guard isolation", () => {
  it("does not declare a role from inherited containers even when main is own and matches", () => {
    const root = Object.create({ containers: { web: { Service: "web" } } });
    root.main = "web";
    const result = normalizeContainers(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ service: "web", ports: [] });
    expect(result[0]).not.toHaveProperty("isMainService");
  });

  it("does not declare a role from an array collection even when main matches its index and service", () => {
    const result = normalizeContainers({ main: "0", containers: [{ Service: "0" }] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ service: "0", ports: [] });
    expect(result[0]).not.toHaveProperty("isMainService");
  });

  it("does not declare a main service from an array-valued store with an own valid main", () => {
    const store = Object.assign([], { main: "web" });
    const result = normalizeAppList({ sample: { store_info: store } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "sample", name: "sample" });
    expect(result[0]).not.toHaveProperty("mainService");
  });
});
