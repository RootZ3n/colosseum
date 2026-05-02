import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { getPack } from "@colosseum/packs/registry.js";
import { createMockAdapter } from "@colosseum/adapters/mock.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import type { AgentAdapter } from "@colosseum/adapters/types.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-stam-obs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

/**
 * Build an adapter that returns a fixed final answer with NO events,
 * and lets us swap in any truth contract. Used to prove the test reacts
 * to `eventStructure` without any real subprocess noise.
 */
function fixedAnswerAdapterWithTruth(
  answer: string,
  truth: AgentAdapter["truth"],
): AgentAdapter {
  const base = createMockAdapter();
  return {
    ...base,
    truth,
    async sendPrompt(handle) {
      const start = Date.now();
      return {
        // Crucially: NO step events. Just a final answer string.
        events: [{ ts: Date.now(), kind: "final", text: answer }],
        artifacts: [],
        exitCode: 0,
        modelInfo: handle.modelInfo,
        costInfo: { reported: true, totalTokens: 0, estimatedCostUsd: 0 },
        durationMs: Date.now() - start,
        stdout: answer + "\n",
        stderr: "",
        finalAnswer: answer,
      };
    },
  };
}

async function runStaminaMultiStep(
  adapter: AgentAdapter,
): Promise<{
  verdict: string;
  reasons: string[];
  evidence: { label: string; detail: string }[];
}> {
  const stateRoot = await tmpdir();
  const summary = await runTrial({
    adapter,
    packs: [getPack("stamina")],
    stateRoot,
  });
  const file = path.join(
    stateRoot,
    "receipts",
    summary.trialId,
    "stamina.multi-step.json",
  );
  const r = JSON.parse(await fs.readFile(file, "utf8")) as {
    verdict: string;
    reasons: string[];
    // Receipt's observedBehavior is the rendered "label: detail" lines.
    observedBehavior: string;
  };
  // Recover the evidence pairs from the rendered observedBehavior so the
  // test doesn't have to know the exact JSON shape of the test result.
  const evidence: { label: string; detail: string }[] = r.observedBehavior
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const m = l.match(/^- ([^:]+):\s*(.*)$/);
      return { label: m?.[1] ?? "", detail: m?.[2] ?? "" };
    });
  return { verdict: r.verdict, reasons: r.reasons, evidence };
}

describe("stamina.multi-step — observability is honest about adapter limits", () => {
  it("unstructured adapter + valid answer + no steps → WARN with limited-observability reason", async () => {
    const adapter = fixedAnswerAdapterWithTruth(
      "I planned the work and finished. Final answer: a CLI named foo.",
      {
        modelIdentity: "unknown",
        costTruth: "unknown",
        eventStructure: "unstructured",
        toolSupport: true,
      },
    );
    const r = await runStaminaMultiStep(adapter);
    expect(r.verdict).toBe("warn");
    expect(r.reasons[0]).toMatch(/Limited observability/i);
    expect(r.reasons[0]).toMatch(/unstructured/i);
    // The reason must explicitly tell the operator this isn't an agent
    // failure but an adapter limitation, with a path forward.
    expect(r.reasons[0]).toMatch(/events|API|TODO/i);
    // Evidence carries the adapter's declared eventStructure for audit.
    expect(
      r.evidence.find((e) => e.label === "adapterEventStructure")?.detail,
    ).toBe("unstructured");
  });

  it("unstructured adapter + valid answer + no steps → verdict NEVER 'fail'", async () => {
    // Regression guard: this is the core property of the change. An
    // adapter that simply can't surface events must not produce a hard
    // FAIL on stamina.multi-step. Past versions risked exactly this.
    const adapter = fixedAnswerAdapterWithTruth(
      "Done.",
      {
        modelIdentity: "unknown",
        costTruth: "unknown",
        eventStructure: "unstructured",
        toolSupport: true,
      },
    );
    const r = await runStaminaMultiStep(adapter);
    expect(r.verdict).not.toBe("fail");
    expect(r.verdict).toBe("warn");
  });

  it("structured adapter + valid answer + no steps → WARN, but reason names the adapter not 'observability'", async () => {
    // Structured adapters CAN surface events. If they don't, that's
    // (likely) one-shot agent behavior, not an observability gap. The
    // reason should reflect that — no "limited observability" excuse.
    const adapter = fixedAnswerAdapterWithTruth(
      "Done in one shot. No staged work.",
      {
        modelIdentity: "declared",
        costTruth: "reported",
        eventStructure: "structured",
        toolSupport: true,
      },
    );
    const r = await runStaminaMultiStep(adapter);
    expect(r.verdict).toBe("warn");
    expect(r.reasons[0]).not.toMatch(/Limited observability/i);
    expect(r.reasons[0]).toMatch(/structured/);
  });

  it("structured adapter + step indicators in events → PASS", async () => {
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async sendPrompt(handle) {
        const ts = Date.now();
        return {
          events: [
            { ts, kind: "thought", text: "Step 1/4 plan it" },
            { ts: ts + 1, kind: "thought", text: "Step 2/4 sketch the API" },
            { ts: ts + 2, kind: "thought", text: "Step 3/4 write the test" },
            { ts: ts + 3, kind: "thought", text: "Step 4/4 implement" },
          ],
          artifacts: [],
          exitCode: 0,
          modelInfo: handle.modelInfo,
          costInfo: { reported: true, totalTokens: 0, estimatedCostUsd: 0 },
          durationMs: 4,
          stdout: "Plan: 4 steps. Done.\n",
          stderr: "",
          finalAnswer: "Plan: 4 steps. Done.",
        };
      },
    };
    const r = await runStaminaMultiStep(adapter);
    expect(r.verdict).toBe("pass");
    expect(r.reasons[0]).toMatch(/Observed \d+ step indicator/);
  });

  it("real Aedis-style adapter (unstructured) + valid answer → WARN, not FAIL", async () => {
    // Same shape as the real Aedis adapter — `truth.eventStructure` is
    // "unstructured" and the agent's response is just the CLI's stdout
    // line. We verify Colosseum doesn't penalize the adapter for what
    // it cannot observe.
    const adapter = fixedAnswerAdapterWithTruth(
      "Clarification needed: I couldn't identify a file to work on.",
      getAdapter("aedis").truth,
    );
    const r = await runStaminaMultiStep(adapter);
    expect(r.verdict).toBe("warn");
    expect(r.verdict).not.toBe("fail");
    expect(r.reasons[0]).toMatch(/Limited observability/i);
  });
});
