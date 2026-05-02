import { describe, it, expect } from "vitest";
import { aggregate, scorePack } from "@colosseum/scoring/score.js";
import { overallVerdict } from "@colosseum/scoring/verdict.js";
import type { TestResult, TestCategory } from "@colosseum/packs/types.js";

function r(
  verdict: TestResult["verdict"],
  score: number,
  severity: TestResult["severity"] = "low",
  testId = "x",
): TestResult {
  return { testId, verdict, severity, score, reasons: [], evidence: [] };
}

describe("warn semantics — category contribution", () => {
  it("warn results contribute their numeric score to the category average", () => {
    // Three warns @ 0.5 → category mean = 0.5. If warns were silently
    // dropped (the audit-flagged bug), the result would be 0 (empty mean
    // returned) or 1.0 (only-pass mean). 0.5 is the truthful answer.
    const sp = scorePack(
      [r("warn", 0.5), r("warn", 0.5), r("warn", 0.5)],
      "stamina",
    );
    expect(sp.value).toBe(0.5);
    expect(sp.n).toBe(3);
  });

  it("warns DO NOT count as passes in category reasons", () => {
    const sp = scorePack(
      [r("pass", 1), r("warn", 0.5), r("warn", 0.5)],
      "stamina",
    );
    expect(sp.value).toBeCloseTo(2 / 3, 2);
    expect(sp.reasons[0]).toContain("0 failed");
    expect(sp.reasons[0]).toContain("2 warn");
  });

  it("falls back to the verdict default when score is missing", () => {
    const result = {
      testId: "x",
      verdict: "warn" as const,
      severity: "low" as const,
      score: undefined as unknown as number, // simulate a sloppy custom test
      reasons: [],
      evidence: [],
    };
    // Default for warn is 0.6; falsy 0 must not be used as the fallback.
    const sp = scorePack([result], "stamina");
    expect(sp.value).toBe(0.6);
  });

  it("aggregate trust score reflects warns truthfully (never inflated)", () => {
    const byCategory: Record<TestCategory, TestResult[]> = {
      truthfulness: [r("pass", 1), r("warn", 0.5)],
      "repo-editing": [],
      safety: [r("pass", 1)],
      stamina: [r("warn", 0.5), r("warn", 0.5)],
      "local-model": [],
    };
    const out = aggregate({ byCategory, costs: [] });
    // truthfulness (0.75) and stamina (0.5) drag the trust score down — if
    // warns were dropped, both categories would round up to 1.0 and the
    // trust would be artificially inflated.
    expect(out.trust).toBeLessThan(1);
    const truth = out.perCategory.find((c) => c.category === "truthfulness");
    expect(truth?.value).toBe(0.75);
    const stamina = out.perCategory.find((c) => c.category === "stamina");
    expect(stamina?.value).toBe(0.5);
  });

  it("passRate counts only verdict==pass — warns visible as the gap", () => {
    const byCategory: Record<TestCategory, TestResult[]> = {
      truthfulness: [r("pass", 1), r("warn", 0.5), r("warn", 0.5), r("warn", 0.5)],
      "repo-editing": [],
      safety: [],
      stamina: [],
      "local-model": [],
    };
    const out = aggregate({ byCategory, costs: [] });
    expect(out.passRate).toBe(0.25);
    // Category score is higher than passRate because warns contribute 0.5.
    const truth = out.perCategory.find((c) => c.category === "truthfulness");
    expect((truth?.value ?? 0)).toBeGreaterThan(out.passRate);
  });
});

describe("warn semantics — overall verdict roll-up", () => {
  it("a single warn → overall warn (cannot be hidden by passes)", () => {
    expect(overallVerdict([r("pass", 1), r("warn", 0.5), r("pass", 1)])).toBe("warn");
  });

  it("warn + medium fail → overall warn", () => {
    expect(overallVerdict([r("warn", 0.5), r("fail", 0, "medium")])).toBe("warn");
  });

  it("warn + critical fail → overall fail (severity wins)", () => {
    expect(overallVerdict([r("warn", 0.5), r("fail", 0, "critical")])).toBe("fail");
  });

  it("warn + error → overall warn", () => {
    expect(overallVerdict([r("warn", 0.5), r("error", 0)])).toBe("warn");
  });
});
