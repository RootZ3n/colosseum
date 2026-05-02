import type {
  AgentArtifact,
  AgentEvent,
  CostInfo,
  ModelInfo,
  Verdict,
} from "../types.js";
import type { FailureType, TestResult } from "../packs/types.js";
import type { VelumScanResult } from "../velum/guard.js";
import type { AdapterTruthContract } from "../adapters/types.js";

/**
 * Receipts are first-class evidence in Colosseum.
 * Every test run produces one. They are stored as JSON and rendered as a
 * human-readable summary; the UI links back to both.
 */

export interface Receipt {
  /** UUID-ish receipt id. Same as test result id within a trial. */
  receiptId: string;
  trialId: string;
  testId: string;
  agentId: string;
  adapter: string;
  /** Adapter-declared version string; never inferred. */
  adapterVersion: string;
  /** Pack the test belongs to + the pack version that produced this receipt. */
  packId: string;
  packVersion: string;
  /** Colosseum harness version at run time. */
  colosseumVersion: string;
  /** Short git commit of the Colosseum repo. "unknown" if not in git. */
  gitCommit: string;
  /** Adapter truth contract — copied onto the receipt for audit. */
  adapterTruth: AdapterTruthContract;
  modelInfo: ModelInfo;
  costInfo: CostInfo;
  prompt: string;
  expectedBehavior: string;
  observedBehavior: string;
  verdict: Verdict;
  /** Required when verdict === "fail". */
  failureType?: FailureType;
  reasons: string[];
  /** Files produced inside the workspace by the agent. */
  artifacts: AgentArtifact[];
  /** Truncated stdout/stderr summary. Always post-redaction. */
  stdoutSummary: string;
  stderrSummary: string;
  /** Repo diff summary string (inline). Empty if not applicable. */
  repoDiffSummary: string;
  /** Whether the diff is changed, unchanged, or unavailable. Older receipts may omit this. */
  repoDiffStatus?: "changed" | "unchanged" | "unavailable";
  repoDiffUnavailableReason?: string;
  /** Velum's view, including redacted snippets. */
  velum: VelumScanResult;
  /** Stream of agent events for replay. Capped. */
  events: AgentEvent[];
  /** Timestamps in ms since epoch. */
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

/** Render a receipt as a Markdown summary suitable for display. */
export function renderReceipt(r: Receipt): string {
  const lines: string[] = [];
  lines.push(`# Receipt — ${r.testId}`);
  lines.push(``);
  lines.push(`**Verdict:** ${r.verdict.toUpperCase()}`);
  if (r.verdict === "fail") {
    lines.push(`**Failure type:** ${r.failureType ?? "unspecified"}`);
  }
  lines.push(`**Agent:** ${r.agentId} (adapter: ${r.adapter} v${r.adapterVersion})`);
  lines.push(`**Pack:** ${r.packId} v${r.packVersion}`);
  lines.push(`**Colosseum:** v${r.colosseumVersion} · commit ${r.gitCommit}`);
  lines.push(
    `**Adapter truth:** model=${r.adapterTruth.modelIdentity} · cost=${r.adapterTruth.costTruth} · events=${r.adapterTruth.eventStructure} · tools=${r.adapterTruth.toolSupport ? "yes" : "no"}`,
  );
  lines.push(
    `**Model:** ${r.modelInfo.model} · **Provider:** ${r.modelInfo.provider} · **Location:** ${r.modelInfo.location}`,
  );
  if (r.costInfo.reported) {
    lines.push(
      `**Cost:** ${r.costInfo.estimatedCostUsd ?? "?"} USD · prompt=${
        r.costInfo.promptTokens ?? "?"
      } output=${r.costInfo.outputTokens ?? "?"}`,
    );
  } else {
    lines.push(`**Cost:** not reported (${r.costInfo.note ?? "n/a"})`);
  }
  lines.push(`**Duration:** ${r.durationMs}ms`);
  lines.push(``);
  lines.push(`## Prompt`);
  lines.push("```");
  lines.push(r.prompt);
  lines.push("```");
  lines.push(`## Expected`);
  lines.push(r.expectedBehavior);
  lines.push(`## Observed`);
  lines.push(r.observedBehavior);
  if (r.reasons.length) {
    lines.push(`## Reasons`);
    for (const reason of r.reasons) lines.push(`- ${reason}`);
  }
  if (r.velum.findings.length) {
    lines.push(`## Velum`);
    lines.push(
      `Overall: **${r.velum.decision}** · Agent-side: **${r.velum.agentDecision ?? r.velum.decision}**`,
    );
    lines.push(
      "_(Agent-side excludes prompt-only findings. Pass→fail override fires only on agent-side fail-test.)_",
    );
    // Group findings by source so reviewers can tell "the prompt had a probe"
    // apart from "the agent did something bad".
    const groups: Record<string, typeof r.velum.findings> = {};
    for (const f of r.velum.findings) {
      const key = (f as { source?: string }).source ?? "unknown";
      (groups[key] ??= []).push(f);
    }
    const order = ["agent_output", "output", "stdout", "stderr", "tool_call", "artifact", "prompt", "unknown"];
    const sortedKeys = Object.keys(groups).sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    for (const k of sortedKeys) {
      const label =
        k === "prompt"
          ? "Challenge findings (prompt) — evidence, never auto-fail"
          : `Agent-side findings (${k})`;
      lines.push(`### ${label}`);
      for (const f of groups[k] ?? []) {
        lines.push(
          `- \`${f.rule}\` (${f.severity}, ${f.decision}): ${f.reason}`,
        );
      }
    }
  }
  if (r.artifacts.length) {
    lines.push(`## Artifacts`);
    for (const a of r.artifacts.slice(0, 50)) {
      lines.push(`- ${a.path} (${a.bytes} bytes)`);
    }
  }
  lines.push(`## Repo Diff`);
  const diffStatus =
    r.repoDiffStatus ?? (r.repoDiffSummary && r.repoDiffSummary.trim().length ? "changed" : "unchanged");
  if (diffStatus === "unavailable") {
    lines.push(
      `_(diff unavailable — ${r.repoDiffUnavailableReason ?? "workspace changes could not be verified"})_`,
    );
  } else if (r.repoDiffSummary && r.repoDiffSummary.trim().length) {
    lines.push("```diff");
    lines.push(r.repoDiffSummary);
    lines.push("```");
  } else {
    lines.push("_(no changes detected — workspace identical to fixture seed)_");
  }
  if (r.stdoutSummary) {
    lines.push(`## stdout (tail, redacted)`);
    lines.push("```");
    lines.push(r.stdoutSummary);
    lines.push("```");
  }
  if (r.stderrSummary) {
    lines.push(`## stderr (tail, redacted)`);
    lines.push("```");
    lines.push(r.stderrSummary);
    lines.push("```");
  }
  return lines.join("\n");
}

export function receiptFromTest(args: {
  trialId: string;
  testId: string;
  agentId: string;
  adapter: string;
  adapterVersion: string;
  adapterTruth: AdapterTruthContract;
  packId: string;
  packVersion: string;
  colosseumVersion: string;
  gitCommit: string;
  prompt: string;
  expectedBehavior: string;
  modelInfo: ModelInfo;
  costInfo: CostInfo;
  events: AgentEvent[];
  artifacts: AgentArtifact[];
  stdout: string;
  stderr: string;
  result: TestResult;
  velum: VelumScanResult;
  startedAt: number;
  finishedAt: number;
  /** Unified diff text from the runner; pass "" if not available. */
  repoDiffSummary?: string;
  repoDiffStatus?: "changed" | "unchanged" | "unavailable";
  repoDiffUnavailableReason?: string;
}): Receipt {
  return {
    receiptId: `${args.trialId}/${args.testId}`,
    trialId: args.trialId,
    testId: args.testId,
    agentId: args.agentId,
    adapter: args.adapter,
    adapterVersion: args.adapterVersion,
    adapterTruth: args.adapterTruth,
    packId: args.packId,
    packVersion: args.packVersion,
    colosseumVersion: args.colosseumVersion,
    gitCommit: args.gitCommit,
    modelInfo: args.modelInfo,
    costInfo: args.costInfo,
    prompt: args.prompt,
    expectedBehavior: args.expectedBehavior,
    observedBehavior: args.result.evidence
      .map((e) => `- ${e.label}: ${e.detail}`)
      .join("\n"),
    verdict: args.result.verdict,
    failureType: args.result.failureType,
    reasons: args.result.reasons,
    artifacts: args.artifacts,
    stdoutSummary: args.stdout.slice(-2000),
    stderrSummary: args.stderr.slice(-2000),
    repoDiffSummary: args.repoDiffSummary ?? "",
    repoDiffStatus: args.repoDiffStatus,
    repoDiffUnavailableReason: args.repoDiffUnavailableReason,
    velum: args.velum,
    events: args.events.slice(-200),
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    durationMs: args.finishedAt - args.startedAt,
  };
}
