import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import type { TestPack } from "@colosseum/packs/types.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-err-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

// Receipts-first invariant: every test the runner touches MUST produce a
// receipt on disk, including tests that throw before completing. Without
// this, the trial summary counts an error that has no on-disk evidence —
// which is exactly the kind of silent-evidence-gap the harness promises
// to prevent.
describe("runner: error-path receipts", () => {
  it("writes a receipt when a test's prompt() throws", async () => {
    const stateRoot = await tmpdir();
    const erroringPack: TestPack = {
      id: "errpack",
      version: "0.0.1",
      title: "errpack",
      description: "intentionally throws to verify error-path receipts",
      tests: [
        {
          id: "errpack.boom",
          title: "boom",
          description: "throws inside prompt() to simulate runner-side failure",
          category: "truthfulness",
          severity: "low",
          prompt: () => {
            throw new Error("synthetic prompt failure");
          },
          assert: async () => ({
            testId: "errpack.boom",
            verdict: "pass",
            severity: "low",
            score: 1,
            reasons: [],
            evidence: [],
          }),
        },
      ],
    };

    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [erroringPack],
      stateRoot,
    });

    expect(summary.testCount).toBe(1);
    // Errors flow through to the trial verdict as "warn" (per scoring/verdict.ts);
    // what matters here is that evidence is on disk.
    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const entries = await fs.readdir(receiptsDir);
    // .json + .md per test, even on the error path.
    expect(entries.length).toBe(summary.testCount * 2);

    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    expect(jsonFiles).toHaveLength(1);
    const receipt = JSON.parse(
      await fs.readFile(path.join(receiptsDir, jsonFiles[0]!), "utf8"),
    ) as {
      verdict: string;
      reasons: string[];
      testId: string;
      failureType?: string;
    };
    expect(receipt.testId).toBe("errpack.boom");
    expect(receipt.verdict).toBe("error");
    expect(receipt.failureType).toBe("incomplete_execution");
    expect(receipt.reasons.join(" ")).toMatch(/synthetic prompt failure/);
  });

  it("writes a receipt when a test's setup() throws", async () => {
    const stateRoot = await tmpdir();
    const erroringPack: TestPack = {
      id: "errpack-setup",
      version: "0.0.1",
      title: "errpack-setup",
      description: "throws in setup",
      tests: [
        {
          id: "errpack-setup.boom",
          title: "boom",
          description: "throws inside setup() before agent ever runs",
          category: "truthfulness",
          severity: "low",
          setup: async () => {
            throw new Error("synthetic setup failure");
          },
          prompt: () => "unused",
          assert: async () => ({
            testId: "errpack-setup.boom",
            verdict: "pass",
            severity: "low",
            score: 1,
            reasons: [],
            evidence: [],
          }),
        },
      ],
    };

    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [erroringPack],
      stateRoot,
    });

    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const entries = await fs.readdir(receiptsDir);
    expect(entries.length).toBe(summary.testCount * 2);
    const json = entries.find((f) => f.endsWith(".json"))!;
    const receipt = JSON.parse(
      await fs.readFile(path.join(receiptsDir, json), "utf8"),
    ) as { verdict: string; reasons: string[] };
    expect(receipt.verdict).toBe("error");
    expect(receipt.reasons.join(" ")).toMatch(/synthetic setup failure/);
  });
});
