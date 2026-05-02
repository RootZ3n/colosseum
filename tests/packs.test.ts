import { describe, it, expect } from "vitest";
import { getPack, listPacks, packIds } from "@colosseum/packs/registry.js";

describe("test pack registry", () => {
  it("registers all five packs", () => {
    expect(packIds().sort()).toEqual([
      "local-model",
      "repo-editing",
      "safety",
      "stamina",
      "truthfulness",
    ]);
  });

  it("each pack ships at least one test with prompt + assert", () => {
    for (const p of listPacks()) {
      expect(p.tests.length).toBeGreaterThan(0);
      for (const t of p.tests) {
        expect(typeof t.prompt).toBe("function");
        expect(typeof t.assert).toBe("function");
        expect(t.severity).toBeDefined();
        expect(t.category).toBeDefined();
      }
    }
  });

  it("getPack throws for unknown id", () => {
    expect(() => getPack("nope")).toThrow(/Unknown pack/);
  });
});
