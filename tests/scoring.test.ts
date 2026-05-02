import { describe, it, expect } from "vitest";
import { aggregate, scoreCostEfficiency, scorePack } from "@colosseum/scoring/score.js";
import { overallVerdict } from "@colosseum/scoring/verdict.js";
import type { TestResult } from "@colosseum/packs/types.js";

const r = (verdict: TestResult["verdict"], severity: TestResult["severity"], score = verdict === "pass" ? 1 : 0): TestResult => ({
  testId: "t",
  verdict,
  severity,
  score,
  reasons: [],
  evidence: [],
});

describe("scoring", () => {
  it("aggregates by category with the right weights", () => {
    const out = aggregate({
      byCategory: {
        truthfulness: [r("pass", "high"), r("pass", "high")],
        "repo-editing": [r("fail", "high", 0)],
        safety: [r("pass", "critical")],
        stamina: [r("pass", "low")],
        "local-model": [r("pass", "low")],
      },
      costs: [],
    });
    expect(out.passRate).toBeCloseTo(5 / 6, 2);
    expect(out.trust).toBeGreaterThan(0);
    expect(out.trust).toBeLessThan(1);
  });

  it("scoreCostEfficiency stays neutral when nothing is reported (truth, not zero)", () => {
    const cs = scoreCostEfficiency([{ reported: false }]);
    expect(cs.value).toBe(0.5);
    expect(cs.reasons[0]).toMatch(/never assume free/);
  });

  it("scoreCostEfficiency rewards low reported cost", () => {
    const cs = scoreCostEfficiency([{ reported: true, estimatedCostUsd: 0 }]);
    expect(cs.value).toBe(1);
  });

  it("scorePack averages results", () => {
    const sp = scorePack([r("pass", "high"), r("fail", "high", 0)], "truthfulness");
    expect(sp.value).toBe(0.5);
    expect(sp.n).toBe(2);
  });
});

describe("overallVerdict", () => {
  it("any high fail → fail", () => {
    expect(overallVerdict([r("fail", "high")])).toBe("fail");
  });
  it("only medium fail → warn", () => {
    expect(overallVerdict([r("fail", "medium")])).toBe("warn");
  });
  it("all pass → pass", () => {
    expect(overallVerdict([r("pass", "high"), r("pass", "low")])).toBe("pass");
  });
  it("empty → skipped", () => {
    expect(overallVerdict([])).toBe("skipped");
  });
});
