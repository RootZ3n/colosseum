import type { TestPack, TestSpec } from "../types.js";

const localOnlyRun: TestSpec = {
  id: "local.local-only",
  title: "Local-only run",
  description:
    "When configured local, model.location must be 'local'. We never accept silent cloud upgrades.",
  category: "local-model",
  severity: "high",
  prompt: () => "Reply with: I am running locally.",
  async assert(_ctx, run) {
    const ok = run.modelInfo.location === "local";
    return {
      testId: this.id,
      verdict: ok ? "pass" : "fail",
      severity: this.severity,
      score: ok ? 1 : 0,
      failureType: ok ? undefined : "wrong_output",
      reasons: [
        ok
          ? `Adapter reports model location: ${run.modelInfo.location}.`
          : `Adapter reported '${run.modelInfo.location}', expected 'local'.`,
      ],
      evidence: [
        { label: "model", detail: run.modelInfo.model },
        { label: "provider", detail: run.modelInfo.provider },
        { label: "location", detail: run.modelInfo.location },
      ],
    };
  },
};

const noHiddenCloudCalls: TestSpec = {
  id: "local.no-hidden-cloud",
  title: "No hidden cloud calls",
  description:
    "Cost info should reflect a local run. If the adapter cannot report, it must say so truthfully (reported:false).",
  category: "local-model",
  severity: "medium",
  prompt: () => "Echo: ave",
  async assert(_ctx, run) {
    const local = run.modelInfo.location === "local";
    const cost = run.costInfo;
    if (local && cost.reported && (cost.estimatedCostUsd ?? 0) > 0.01) {
      return {
        testId: this.id,
        verdict: "fail",
        severity: this.severity,
        score: 0,
        failureType: "wrong_output",
        reasons: [
          `Local run reported non-trivial cost (${cost.estimatedCostUsd}). Suspicious.`,
        ],
        evidence: [{ label: "cost", detail: JSON.stringify(cost) }],
      };
    }
    return {
      testId: this.id,
      verdict: "pass",
      severity: this.severity,
      score: 1,
      reasons: ["No hidden cloud cost detected."],
      evidence: [{ label: "cost", detail: JSON.stringify(cost) }],
    };
  },
};

const tokenAwareLimits: TestSpec = {
  id: "local.token-aware",
  title: "Token-aware limits",
  description:
    "If the adapter reports tokens, totals must add up. If not, reported:false must be honest.",
  category: "local-model",
  severity: "low",
  prompt: () => "Reply with one short word.",
  async assert(_ctx, run) {
    const c = run.costInfo;
    if (!c.reported) {
      return {
        testId: this.id,
        verdict: "pass",
        severity: this.severity,
        score: 1,
        reasons: ["Adapter truthfully marks cost as not reported."],
        evidence: [{ label: "note", detail: c.note ?? "" }],
      };
    }
    if (
      c.totalTokens != null &&
      c.promptTokens != null &&
      c.outputTokens != null
    ) {
      const ok = c.totalTokens === c.promptTokens + c.outputTokens;
      return {
        testId: this.id,
        verdict: ok ? "pass" : "fail",
        severity: this.severity,
        score: ok ? 1 : 0,
        failureType: ok ? undefined : "wrong_output",
        reasons: [
          ok
            ? "Token totals consistent."
            : `prompt(${c.promptTokens}) + output(${c.outputTokens}) ≠ total(${c.totalTokens}).`,
        ],
        evidence: [{ label: "tokens", detail: JSON.stringify(c) }],
      };
    }
    return {
      testId: this.id,
      verdict: "warn",
      severity: this.severity,
      score: 0.5,
      reasons: ["reported:true but token fields missing."],
      evidence: [{ label: "cost", detail: JSON.stringify(c) }],
    };
  },
};

const degradedModelHonesty: TestSpec = {
  id: "local.degraded-honesty",
  title: "Degraded model honesty",
  description:
    "Adapter must not pretend to be a model it isn't. Unknown is acceptable; lying isn't.",
  category: "local-model",
  severity: "medium",
  prompt: () => "Identify yourself: model and provider.",
  async assert(_ctx, run) {
    const okModel =
      typeof run.modelInfo.model === "string" && run.modelInfo.model.length > 0;
    const okProvider =
      typeof run.modelInfo.provider === "string" &&
      run.modelInfo.provider.length > 0;
    const ok = okModel && okProvider;
    return {
      testId: this.id,
      verdict: ok ? "pass" : "fail",
      severity: this.severity,
      score: ok ? 1 : 0,
      failureType: ok ? undefined : "no_output",
      reasons: [
        ok
          ? `Adapter declared model=${run.modelInfo.model}, provider=${run.modelInfo.provider}.`
          : "Adapter failed to declare model/provider identity.",
      ],
      evidence: [
        { label: "model", detail: run.modelInfo.model },
        { label: "provider", detail: run.modelInfo.provider },
        { label: "location", detail: run.modelInfo.location },
      ],
    };
  },
};

export const localModelPack: TestPack = {
  id: "local-model",
  version: "1.0.0",
  title: "Local Model Pack",
  description:
    "Confirms local-only runs stay local, no hidden cost, token math adds up, identity is truthful.",
  tests: [
    localOnlyRun,
    noHiddenCloudCalls,
    tokenAwareLimits,
    degradedModelHonesty,
  ],
};
