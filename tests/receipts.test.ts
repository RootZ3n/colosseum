import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { receiptFromTest, renderReceipt } from "@colosseum/receipts/receipt.js";
import { ReceiptStore } from "@colosseum/receipts/receipt-store.js";
import type { AdapterTruthContract } from "@colosseum/adapters/types.js";

async function tmpdir(): Promise<string> {
  const d = path.join(os.tmpdir(), `colosseum-receipts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

const truth: AdapterTruthContract = {
  modelIdentity: "declared",
  costTruth: "reported",
  eventStructure: "structured",
  toolSupport: true,
};

const stamps = {
  adapterVersion: "0.1.0",
  adapterTruth: truth,
  packId: "truthfulness",
  packVersion: "1.0.0",
  colosseumVersion: "0.1.0",
  gitCommit: "abcdef012345",
};

describe("receipts", () => {
  it("renders a markdown summary with all key sections", () => {
    const r = receiptFromTest({
      trialId: "t1",
      testId: "test.x",
      agentId: "mock",
      adapter: "mock",
      ...stamps,
      prompt: "do the thing",
      expectedBehavior: "produce a file",
      modelInfo: { model: "m", provider: "p", location: "local" },
      costInfo: { reported: true, estimatedCostUsd: 0, totalTokens: 12 },
      events: [{ ts: 1, kind: "thought", text: "ok" }],
      artifacts: [{ path: "out.txt", bytes: 5 }],
      stdout: "ok\n",
      stderr: "",
      result: {
        testId: "test.x",
        verdict: "pass",
        severity: "low",
        score: 1,
        reasons: ["it worked"],
        evidence: [{ label: "file", detail: "out.txt exists" }],
      },
      velum: { findings: [], decision: "allow", agentDecision: "allow", safeText: "" },
      startedAt: 0,
      finishedAt: 100,
    });
    const md = renderReceipt(r);
    expect(md).toContain("# Receipt");
    expect(md).toContain("**Verdict:** PASS");
    expect(md).toContain("**Pack:** truthfulness v1.0.0");
    expect(md).toContain("**Colosseum:** v0.1.0");
    expect(md).toContain("**Adapter truth:** model=declared");
    expect(md).toContain("## Prompt");
    expect(md).toContain("Reasons");
  });

  it("includes failureType in the rendered FAIL receipt", () => {
    const r = receiptFromTest({
      trialId: "t",
      testId: "test.fail",
      agentId: "mock",
      adapter: "mock",
      ...stamps,
      prompt: "p",
      expectedBehavior: "e",
      modelInfo: { model: "m", provider: "p", location: "local" },
      costInfo: { reported: false, note: "n/a" },
      events: [],
      artifacts: [],
      stdout: "",
      stderr: "",
      result: {
        testId: "test.fail",
        verdict: "fail",
        severity: "high",
        score: 0,
        failureType: "silent_success",
        reasons: ["claimed success but produced nothing"],
        evidence: [],
      },
      velum: { findings: [], decision: "allow", agentDecision: "allow", safeText: "" },
      startedAt: 0,
      finishedAt: 1,
    });
    expect(r.failureType).toBe("silent_success");
    const md = renderReceipt(r);
    expect(md).toContain("**Failure type:** silent_success");
  });

  it("ReceiptStore writes and reads back", async () => {
    const root = await tmpdir();
    const store = new ReceiptStore(root);
    const r = receiptFromTest({
      trialId: "trialX",
      testId: "test.y",
      agentId: "mock",
      adapter: "mock",
      ...stamps,
      prompt: "p",
      expectedBehavior: "e",
      modelInfo: { model: "m", provider: "p", location: "local" },
      costInfo: { reported: false, note: "n/a" },
      events: [],
      artifacts: [],
      stdout: "",
      stderr: "",
      result: { testId: "test.y", verdict: "pass", severity: "low", score: 1, reasons: [], evidence: [] },
      velum: { findings: [], decision: "allow", agentDecision: "allow", safeText: "" },
      startedAt: 0,
      finishedAt: 1,
    });
    const { jsonPath, mdPath } = await store.save(r);
    expect((await fs.stat(jsonPath)).size).toBeGreaterThan(0);
    expect((await fs.stat(mdPath)).size).toBeGreaterThan(0);

    const list = await store.list("trialX");
    expect(list).toHaveLength(1);

    const got = await store.get("trialX", "test.y");
    expect(got?.testId).toBe("test.y");
    expect(got?.adapterVersion).toBe("0.1.0");
    expect(got?.adapterTruth.modelIdentity).toBe("declared");
  });

  it("receipt records 'not reported' truthfully when cost is unknown", () => {
    const r = receiptFromTest({
      trialId: "t",
      testId: "x",
      agentId: "a",
      adapter: "a",
      ...stamps,
      prompt: "",
      expectedBehavior: "",
      modelInfo: { model: "?", provider: "?", location: "unknown" },
      costInfo: { reported: false, note: "blah" },
      events: [],
      artifacts: [],
      stdout: "",
      stderr: "",
      result: { testId: "x", verdict: "pass", severity: "low", score: 1, reasons: [], evidence: [] },
      velum: { findings: [], decision: "allow", agentDecision: "allow", safeText: "" },
      startedAt: 0,
      finishedAt: 0,
    });
    expect(renderReceipt(r)).toContain("not reported");
  });

  it("distinguishes unavailable diffs from unchanged workspaces", () => {
    const r = receiptFromTest({
      trialId: "t",
      testId: "x",
      agentId: "a",
      adapter: "a",
      ...stamps,
      prompt: "",
      expectedBehavior: "",
      modelInfo: { model: "?", provider: "?", location: "unknown" },
      costInfo: { reported: false, note: "blah" },
      events: [],
      artifacts: [],
      stdout: "",
      stderr: "",
      result: { testId: "x", verdict: "pass", severity: "low", score: 1, reasons: [], evidence: [] },
      velum: { findings: [], decision: "allow", agentDecision: "allow", safeText: "" },
      repoDiffStatus: "unavailable",
      repoDiffUnavailableReason: "git unavailable",
      startedAt: 0,
      finishedAt: 0,
    });
    expect(renderReceipt(r)).toContain("diff unavailable — git unavailable");
    expect(renderReceipt(r)).not.toContain("workspace identical");
  });
});
