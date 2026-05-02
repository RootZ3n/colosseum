import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import { getPack } from "@colosseum/packs/registry.js";

async function tmpdir(): Promise<string> {
  const d = path.join(os.tmpdir(), `colosseum-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe("runner", () => {
  it("runs the truthfulness pack against the mock adapter and stores receipts", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    expect(summary.testCount).toBeGreaterThan(0);
    expect(["pass", "fail", "warn"].includes(summary.verdict)).toBe(true);

    const trialFile = path.join(stateRoot, "trials", `${summary.trialId}.json`);
    expect((await fs.stat(trialFile)).size).toBeGreaterThan(0);

    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const entries = await fs.readdir(receiptsDir);
    expect(entries.length).toBe(summary.testCount * 2); // .json + .md per test
  });

  it("safety pack: Velum elevates pass→fail when output triggers fail-test rules", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("safety")],
      stateRoot,
    });
    // The mock adapter emits a fake key when the prompt says "leak-secret"; Velum must catch it.
    expect(summary.velumDecision).toMatch(/warn|fail-test/);
  });

  it("does not dirty the host repo — fixtures live under stateRoot", async () => {
    const stateRoot = await tmpdir();
    const before = await fs.readdir(process.cwd());
    await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("repo-editing")],
      stateRoot,
    });
    const after = await fs.readdir(process.cwd());
    expect(after.sort()).toEqual(before.sort());
  });

  it("populates repoDiffSummary on receipts when the agent edits files", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("repo-editing")],
      stateRoot,
    });
    // The repo-editing pack edits files via the mock; at least one receipt must
    // contain a non-empty diff with the expected change.
    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(receiptsDir)).filter((f) => f.endsWith(".json"));
    let foundDiff = false;
    let foundReason = false;
    for (const f of files) {
      const r = JSON.parse(
        await fs.readFile(path.join(receiptsDir, f), "utf8"),
      ) as { repoDiffSummary: string; reasons: string[] };
      if (r.repoDiffSummary && r.repoDiffSummary.length > 0) foundDiff = true;
      if (Array.isArray(r.reasons) && r.reasons.length > 0) foundReason = true;
    }
    expect(foundDiff).toBe(true);
    expect(foundReason).toBe(true);
  });

  it("redacts secrets that appear inside the diff text", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [
        // Use the safety pack — secret-redaction makes the agent echo a fake key,
        // and if any test wrote that into a file, the diff must be redacted too.
        getPack("safety"),
      ],
      stateRoot,
    });
    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(receiptsDir)).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const r = JSON.parse(
        await fs.readFile(path.join(receiptsDir, f), "utf8"),
      ) as { repoDiffSummary: string };
      // No raw secret pattern should leak through the diff field.
      expect(r.repoDiffSummary).not.toMatch(/sk-ant-api03-[A-Za-z0-9]{20,}/);
    }
    expect(summary.trialId).toMatch(/^trial-/);
  });

  it("local-model pack: mock is reported as local with zero cost", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("local-model")],
      stateRoot,
      baseRunOptions: { location: "local" },
    });
    // All four local-model tests should pass for the mock adapter (which is honest).
    expect(summary.passCount).toBe(summary.testCount);
  });
});
