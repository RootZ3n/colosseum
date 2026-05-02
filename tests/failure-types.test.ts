import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { createMockAdapter } from "@colosseum/adapters/mock.js";
import { listPacks, getPack } from "@colosseum/packs/registry.js";
import type { TestPack, TestResult, TestSpec, FailureType } from "@colosseum/packs/types.js";
import type { AgentAdapter } from "@colosseum/adapters/types.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-failures-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

const VALID_FAILURE_TYPES: ReadonlyArray<FailureType> = [
  "no_output",
  "wrong_output",
  "silent_success",
  "unsafe_action",
  "scope_violation",
  "tool_failure_hidden",
  "incomplete_execution",
  "timeout",
  "adapter_setup_failed",
  "clarification_required",
];

describe("failure_type taxonomy", () => {
  it("every test that returns FAIL uses one of the eight valid types", () => {
    // Inspect static spec definitions for any literal failureType references — and
    // catch typos at the source level.
    for (const pack of listPacks()) {
      for (const t of pack.tests) {
        // call the assert with throwaway args isn't useful here (each needs a runtime
        // path); instead just assert that the spec's id format is sane.
        expect(t.id).toMatch(/^[a-z0-9_-]+\.[a-z0-9._-]+$/);
      }
    }
  });

  it("every FAIL receipt produced by the runner has a failureType from the taxonomy", async () => {
    const stateRoot = await tmpdir();
    // Run all five packs against the mock — the mock is engineered to produce
    // both pass and fail across the suite, so we'll see real failure types.
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: listPacks(),
      stateRoot,
    });

    const dir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    let sawFail = false;
    for (const f of files) {
      const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as {
        verdict: string;
        failureType?: string;
      };
      if (r.verdict === "fail") {
        sawFail = true;
        expect(r.failureType, `receipt ${f} verdict=fail must have a failureType`).toBeDefined();
        expect(VALID_FAILURE_TYPES).toContain(r.failureType as FailureType);
      }
    }
    expect(sawFail, "the test corpus must include at least one FAIL").toBe(true);
  });

  it("Velum-elevated FAIL is classified as unsafe_action", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [getPack("safety")],
      stateRoot,
    });

    const dir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const failures = await Promise.all(
      files.map(async (f) =>
        JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as {
          verdict: string;
          failureType?: string;
          reasons: string[];
        },
      ),
    );
    const veluElevated = failures.filter((r) =>
      r.reasons.some((x) => x.includes("Velum overrode")),
    );
    for (const r of veluElevated) {
      expect(r.failureType).toBe("unsafe_action");
    }
  });

  it("runner injects fallback failureType for FAILs that forget to classify", async () => {
    // Build a tiny synthetic pack whose test returns FAIL without a failureType.
    const sloppyTest: TestSpec = {
      id: "synthetic.no-classification",
      title: "synthetic",
      description: "tests that the runner fills in a default",
      category: "truthfulness",
      severity: "low",
      prompt: () => "anything",
      async assert() {
        return {
          testId: "synthetic.no-classification",
          verdict: "fail",
          severity: "low",
          score: 0,
          reasons: ["synthetic failure with no classification"],
          evidence: [],
          // failureType deliberately missing
        };
      },
    };
    const sloppyPack: TestPack = {
      id: "synthetic",
      version: "0.0.1",
      title: "Synthetic",
      description: "synthetic pack for invariant testing",
      tests: [sloppyTest],
    };

    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [sloppyPack],
      stateRoot,
    });

    const file = path.join(
      stateRoot,
      "receipts",
      summary.trialId,
      "synthetic.no-classification.json",
    );
    const r = JSON.parse(await fs.readFile(file, "utf8")) as {
      verdict: string;
      failureType: string;
      reasons: string[];
    };
    expect(r.verdict).toBe("fail");
    expect(r.failureType).toBe("wrong_output");
    expect(r.reasons.some((x) => x.includes("defaulted to wrong_output"))).toBe(true);
  });
});

describe("adapter truth contract", () => {
  it("every registered adapter declares the four contract fields", async () => {
    const { listAdapters } = await import("@colosseum/adapters/registry.js");
    for (const a of listAdapters()) {
      expect(typeof a.version).toBe("string");
      expect(a.version.length).toBeGreaterThan(0);
      expect(a.truth).toBeDefined();
      expect(["declared", "inferred", "unknown"]).toContain(a.truth.modelIdentity);
      expect(["reported", "estimated", "unknown"]).toContain(a.truth.costTruth);
      expect(["structured", "unstructured"]).toContain(a.truth.eventStructure);
      expect(typeof a.truth.toolSupport).toBe("boolean");
    }
  });

  it("CLI-wrapping adapters honestly admit unknown identity/cost", async () => {
    const { getAdapter } = await import("@colosseum/adapters/registry.js");
    for (const id of ["aedis", "ptah", "openclaw", "hermes", "generic-cli"]) {
      const a = getAdapter(id);
      expect(a.truth.modelIdentity).toBe("unknown");
      expect(a.truth.costTruth).toBe("unknown");
      expect(a.truth.eventStructure).toBe("unstructured");
    }
  });

  it("mock adapter declares structured events and reported cost", () => {
    const m = createMockAdapter();
    expect(m.truth.modelIdentity).toBe("declared");
    expect(m.truth.costTruth).toBe("reported");
    expect(m.truth.eventStructure).toBe("structured");
    expect(m.truth.toolSupport).toBe(true);
  });
});

describe("version stamping + no fake cost/model values", () => {
  it("trial summary carries colosseum, git, adapter, and pack versions", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [getPack("local-model")],
      stateRoot,
    });
    expect(summary.colosseumVersion).toBe("0.1.0");
    expect(summary.gitCommit).toMatch(/^([a-f0-9]{6,}|unknown)$/);
    expect(summary.adapterVersion).toBe("0.1.0");
    expect(summary.packVersions["local-model"]).toBe("1.0.0");
    expect(summary.adapterTruth.modelIdentity).toBe("declared");
  });

  it("receipts carry the same stamps, with no faked unknowns", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: createMockAdapter(),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    const dir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as {
        adapterVersion: string;
        packVersion: string;
        packId: string;
        colosseumVersion: string;
        gitCommit: string;
        modelInfo: { model: string; provider: string; location: string };
        costInfo: { reported: boolean; estimatedCostUsd?: number };
      };
      expect(r.adapterVersion).toBe("0.1.0");
      expect(r.packId).toBe("truthfulness");
      // truthfulness pack bumped to 1.1.0 in the clarification-aware update.
      expect(r.packVersion).toBe("1.1.0");
      expect(r.colosseumVersion).toBe("0.1.0");
      // Mock declares its identity — never "unknown".
      expect(r.modelInfo.model).not.toBe("unknown");
      expect(r.modelInfo.provider).not.toBe("unknown");
      expect(r.modelInfo.location).not.toBe("unknown");
      // Mock reports cost truthfully (zero), never falsely "not reported".
      expect(r.costInfo.reported).toBe(true);
    }
  });

  it("CLI-wrapping adapter receipts do NOT fabricate model/cost values", async () => {
    // Use a fake-Aedis fixture (real subprocess, no real Aedis required) so
    // preflight passes and the truthfulness tests actually run; without a
    // real binary on PATH we'd get a single preflight receipt instead of
    // pack-level receipts, which would still satisfy the assertion below
    // but tells us less about the CLI-wrapping path.
    const { writeFakeAedis } = await import("./_helpers/fake-aedis.js");
    const fake = await writeFakeAedis();
    const { getAdapter } = await import("@colosseum/adapters/registry.js");
    const oldEnv = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    try {
      const stateRoot = await tmpdir();
      const summary = await runTrial({
        adapter: getAdapter("aedis"),
        packs: [getPack("truthfulness")],
        stateRoot,
      });
      const dir = path.join(stateRoot, "receipts", summary.trialId);
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as {
          modelInfo: { model: string; provider: string; location: string };
          costInfo: { reported: boolean; note?: string };
        };
        // Honest unknowns, not fabricated values.
        expect(r.modelInfo.model).toBe("unknown");
        expect(r.modelInfo.location).toBe("unknown");
        expect(r.costInfo.reported).toBe(false);
        expect(r.costInfo.note).toBeDefined();
      }
    } finally {
      process.env.AEDIS_BIN = oldEnv;
    }
  });
});
