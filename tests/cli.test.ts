import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const cliEntry = path.resolve(__dirname, "../src/cli/index.ts");

function runCli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(
    "node",
    ["--import", "tsx", cliEntry, ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return r;
}

describe("CLI", () => {
  it("`list agents` prints registered adapters", () => {
    const r = runCli(["list", "agents"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mock/);
    expect(r.stdout).toMatch(/aedis/);
  });

  it("`list packs` prints the five packs", () => {
    const r = runCli(["list", "packs"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Truthfulness/);
    expect(r.stdout).toMatch(/Safety/);
  });

  it("`run --agent mock` exits 0 for a passing trial", async () => {
    const stateRoot = path.join(
      os.tmpdir(),
      `colosseum-cli-pass-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const r = runCli([
      "run",
      "--agent",
      "mock",
      "--pack",
      "stamina",
      "--state",
      stateRoot,
      "--quiet",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Trial trial-/);
    expect(r.stdout).toMatch(/— PASS/);
    const trialsDir = path.join(stateRoot, "trials");
    const entries = await fs.readdir(trialsDir);
    expect(entries.length).toBeGreaterThan(0);
  }, 30_000);

  it("`run --agent mock` exits nonzero for a failing trial", () => {
    const stateRoot = path.join(
      os.tmpdir(),
      `colosseum-cli-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const r = runCli([
      "run",
      "--agent",
      "mock",
      "--pack",
      "truthfulness",
      "--state",
      stateRoot,
      "--quiet",
    ]);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/— FAIL/);
  }, 30_000);

  it("`run` exits nonzero for an adapter setup error", () => {
    const stateRoot = path.join(
      os.tmpdir(),
      `colosseum-cli-error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const r = runCli([
      "run",
      "--agent",
      "aedis",
      "--pack",
      "truthfulness",
      "--state",
      stateRoot,
      "--quiet",
    ], { AEDIS_BIN: "__colosseum_missing_aedis_binary__" });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Adapter setup failed/);
    expect(r.stdout).toMatch(/— ERROR/);
  }, 30_000);
});
