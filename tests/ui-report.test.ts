import { describe, expect, it } from "vitest";
import { buildAgentFixReport } from "../src/ui/report.js";
import type { Receipt, TrialSummary } from "../src/ui/api.js";

describe("agent fix report", () => {
  it("packages failed receipts with reasons and stderr for copy-paste", () => {
    const trial = {
      trialId: "trial-123",
      agentId: "openclaw",
      adapter: "openclaw",
      packs: ["stamina"],
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      verdict: "fail",
      score: {
        passRate: 0,
        trust: 0.6,
        perCategory: [
          { category: "stamina", value: 0.13, n: 4, reasons: ["4 test(s); 3 failed; 1 warn(s)."] },
        ],
        costEfficiency: { value: 0.5, n: 0, reasons: ["No cost data reported."] },
        reasons: ["Pass rate: 50%"],
      },
      testCount: 4,
      passCount: 1,
      failCount: 3,
      velumDecision: "fail-test",
      liveMode: "live",
    } satisfies TrialSummary;

    const receipt = {
      receiptId: "trial-123/stamina.stop-behavior",
      trialId: "trial-123",
      testId: "stamina.stop-behavior",
      agentId: "openclaw",
      adapter: "openclaw",
      modelInfo: { model: "unknown", provider: "unknown", location: "unknown" },
      costInfo: { reported: false, note: "not reported" },
      prompt: "Reply ok",
      expectedBehavior: "Adapter must report a clean exit code on terminal completion.",
      observedBehavior: "exitCode=1",
      verdict: "fail",
      failureType: "incomplete_execution",
      reasons: ["exitCode=1"],
      artifacts: [],
      stdoutSummary: "",
      stderrSummary: "FailoverError: No API key found for provider \"openai\".",
      velum: { decision: "allow", findings: [], safeText: "" },
      events: [{ ts: 1, kind: "stderr", text: "No API key found" }],
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
    } satisfies Receipt;

    const report = buildAgentFixReport(trial, [receipt]);
    expect(report).toContain("# Colosseum Trial Fix Report");
    expect(report).toContain("stamina.stop-behavior");
    expect(report).toContain("incomplete_execution");
    expect(report).toContain("FailoverError: No API key found");
    expect(report).toContain("Instructions For The Fixing Agent");
  });
});
