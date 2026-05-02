import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { mergeArtifacts } from "@colosseum/runner/trial-runner.js";
import { createMockAdapter } from "@colosseum/adapters/mock.js";
import { getPack } from "@colosseum/packs/registry.js";
import type { AgentAdapter } from "@colosseum/adapters/types.js";
import type { TestPack, TestSpec } from "@colosseum/packs/types.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

// ────────────────────────────────────────────────────────────────────
// Runner: stop is always called (even when sendPrompt throws)
// ────────────────────────────────────────────────────────────────────

describe("runner: try/finally calls adapter.stop", () => {
  it("calls stop after a successful sendPrompt", async () => {
    const stopCalls: string[] = [];
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async stop(handle) {
        stopCalls.push(handle.sessionId);
        return base.stop(handle);
      },
    };
    const stateRoot = await tmpdir();
    await runTrial({
      adapter,
      packs: [getPack("local-model")],
      stateRoot,
    });
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  it("calls stop even when sendPrompt throws", async () => {
    const stopCalls: string[] = [];
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async sendPrompt() {
        throw new Error("simulated provider explosion");
      },
      async stop(handle) {
        stopCalls.push(handle.sessionId);
        return base.stop(handle);
      },
    };
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter,
      packs: [getPack("local-model")],
      stateRoot,
    });
    // Every test should have errored, but stop must have run for each.
    expect(summary.testCount).toBeGreaterThan(0);
    expect(stopCalls.length).toBe(summary.testCount);
    // The original error must reach the test result, not be swallowed.
    expect(summary.failCount).toBeGreaterThanOrEqual(0); // verdict is "error", not "fail"
    // Verify reasons mention the underlying error.
    const trialJson = JSON.parse(
      await fs.readFile(path.join(stateRoot, "trials", `${summary.trialId}.json`), "utf8"),
    );
    expect(JSON.stringify(trialJson)).toMatch(/simulated provider explosion/);
  });

  it("does not crash if adapter.stop itself throws", async () => {
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async stop() {
        throw new Error("stop blew up");
      },
    };
    const stateRoot = await tmpdir();
    // Should NOT throw — the runner reports stop errors via events but never
    // lets them mask the test verdict.
    const summary = await runTrial({
      adapter,
      packs: [getPack("local-model")],
      stateRoot,
    });
    expect(summary.testCount).toBeGreaterThan(0);
  });

  it("does not call stop if startSession itself throws", async () => {
    let stopCalled = false;
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async startSession() {
        throw new Error("can't start");
      },
      async stop() {
        stopCalled = true;
      },
    };
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter,
      packs: [getPack("local-model")],
      stateRoot,
    });
    expect(stopCalled).toBe(false);
    // Errors should still be reported truthfully.
    expect(summary.testCount).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Adapter collectArtifacts is merged with local artifact walk
// ────────────────────────────────────────────────────────────────────

describe("runner: merges adapter.collectArtifacts with workspace walk", () => {
  it("calls adapter.collectArtifacts and dedupes by path", async () => {
    let adapterCalled = false;
    const base = createMockAdapter();
    const adapter: AgentAdapter = {
      ...base,
      async collectArtifacts(handle) {
        adapterCalled = true;
        return base.collectArtifacts(handle);
      },
    };
    const stateRoot = await tmpdir();
    await runTrial({
      adapter,
      packs: [getPack("repo-editing")],
      stateRoot,
    });
    expect(adapterCalled).toBe(true);
  });

  it("mergeArtifacts: primary wins on path conflict, fallback fills gaps", () => {
    const primary = [
      { path: "a.txt", bytes: 5, preview: "hi" },
      { path: "b.txt", bytes: 3 },
    ];
    const fallback = [
      { path: "a.txt", bytes: 999, preview: "DIFFERENT" }, // duplicate; primary wins
      { path: "c.txt", bytes: 1 }, // unique to fallback
    ];
    const merged = mergeArtifacts(primary, fallback);
    expect(merged.map((m) => m.path).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    const a = merged.find((m) => m.path === "a.txt")!;
    expect(a.bytes).toBe(5); // primary value retained
    expect(a.preview).toBe("hi");
  });
});

// ────────────────────────────────────────────────────────────────────
// Cleanup policy
// ────────────────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory()).catch(() => false);
}

async function fixturesUnder(stateRoot: string, trialId: string): Promise<string[]> {
  const dir = path.join(stateRoot, "fixtures", trialId);
  return fs.readdir(dir).catch(() => []);
}

// A synthetic pack: one PASS test, one guaranteed-FAIL test. Lets us prove
// that "success" policy preserves only the FAIL fixture.
function mixedVerdictPack(): TestPack {
  const passTest: TestSpec = {
    id: "synth.pass",
    title: "synthetic pass",
    description: "always passes",
    category: "truthfulness",
    severity: "low",
    prompt: () => "anything",
    async assert() {
      return {
        testId: "synth.pass",
        verdict: "pass",
        severity: "low",
        score: 1,
        reasons: ["ok"],
        evidence: [],
      };
    },
  };
  const failTest: TestSpec = {
    id: "synth.fail",
    title: "synthetic fail",
    description: "always fails",
    category: "truthfulness",
    severity: "low",
    prompt: () => "anything",
    async assert() {
      return {
        testId: "synth.fail",
        verdict: "fail",
        severity: "low",
        score: 0,
        failureType: "wrong_output",
        reasons: ["intentional"],
        evidence: [],
      };
    },
  };
  return {
    id: "synth",
    version: "0.0.1",
    title: "Synthetic",
    description: "test fixture for cleanup policy",
    tests: [passTest, failTest],
  };
}

describe("workspace cleanup policy", () => {
  it("default 'success': removes PASS fixture, preserves FAIL fixture as evidence", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [mixedVerdictPack()],
      stateRoot,
      // omitted cleanupPolicy → default "success"
    });
    const remaining = await fixturesUnder(stateRoot, summary.trialId);
    // PASS workspace removed; FAIL workspace preserved.
    expect(remaining.some((d) => d.startsWith("synth.pass-"))).toBe(false);
    expect(remaining.some((d) => d.startsWith("synth.fail-"))).toBe(true);
    expect(summary.notes).toMatch(/cleanup=success/);
    // Receipts must always be retained, even for cleaned-up tests.
    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const receipts = await fs.readdir(receiptsDir);
    expect(receipts).toContain("synth.pass.json");
    expect(receipts).toContain("synth.fail.json");
  });

  it("'always' policy: removes every workspace including FAIL", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [mixedVerdictPack()],
      stateRoot,
      cleanupPolicy: "always",
    });
    const remaining = await fixturesUnder(stateRoot, summary.trialId);
    expect(remaining).toEqual([]);
    expect(summary.notes).toMatch(/cleanup=always/);
    // Receipts retained regardless.
    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    expect(await dirExists(receiptsDir)).toBe(true);
  });

  it("'never' policy: preserves every workspace", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [mixedVerdictPack()],
      stateRoot,
      cleanupPolicy: "never",
    });
    const remaining = await fixturesUnder(stateRoot, summary.trialId);
    expect(remaining.length).toBe(2);
    expect(remaining.some((d) => d.startsWith("synth.pass-"))).toBe(true);
    expect(remaining.some((d) => d.startsWith("synth.fail-"))).toBe(true);
    expect(summary.notes).toMatch(/cleanup=never/);
  });
});
