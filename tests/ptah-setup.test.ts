import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import { getPack } from "@colosseum/packs/registry.js";
import { resolvePtahLaunch } from "@colosseum/adapters/ptah.js";
import { writeFakePtah } from "./_helpers/fake-ptah.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-ptah-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

// ────────────────────────────────────────────────────────────────────
//  resolvePtahLaunch — env + args + fallback
// ────────────────────────────────────────────────────────────────────

describe("resolvePtahLaunch", () => {
  it("default — falls back to literal 'ptah' on PATH", () => {
    const old = process.env.PTAH_BIN;
    delete process.env.PTAH_BIN;
    const r = resolvePtahLaunch({});
    expect(r.command).toBe("ptah");
    expect(r.args).toEqual([]);
    expect(r.source).toBe("default");
    process.env.PTAH_BIN = old;
  });

  it("PTAH_BIN — single absolute path", () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "/usr/local/bin/ptah";
    const r = resolvePtahLaunch({});
    expect(r.command).toBe("/usr/local/bin/ptah");
    expect(r.args).toEqual([]);
    expect(r.source).toBe("PTAH_BIN");
    process.env.PTAH_BIN = old;
  });

  it("PTAH_BIN — runner with args (\"node /path/to/ptah/dist/cli.js\")", () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "node /path/to/ptah/dist/cli.js";
    const r = resolvePtahLaunch({});
    expect(r.command).toBe("node");
    expect(r.args).toEqual(["/path/to/ptah/dist/cli.js"]);
    expect(r.source).toBe("PTAH_BIN");
    process.env.PTAH_BIN = old;
  });

  it("extra.command takes precedence over PTAH_BIN", () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "/usr/local/bin/ptah";
    const r = resolvePtahLaunch({ extra: { command: "/bin/echo", args: ["--foo"] } });
    expect(r.command).toBe("/bin/echo");
    expect(r.args).toEqual(["--foo"]);
    expect(r.source).toBe("extra.command");
    process.env.PTAH_BIN = old;
  });
});

// ────────────────────────────────────────────────────────────────────
//  Adapter shape + protocol metadata
// ────────────────────────────────────────────────────────────────────

describe("Ptah adapter — shape + protocol metadata", () => {
  it("registers under id 'ptah' with the documented truth contract", () => {
    const a = getAdapter("ptah");
    expect(a.id).toBe("ptah");
    expect(a.name).toBe("Ptah");
    expect(a.version).toBeDefined();
    expect(a.truth).toEqual({
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    });
  });

  it("declares protocol={ name: 'ptah-cli', submitCommand: '<ptah> submit <prompt>' }", () => {
    const a = getAdapter("ptah");
    expect(a.protocol).toBeDefined();
    expect(a.protocol?.name).toBe("ptah-cli");
    expect(a.protocol?.submitCommand).toContain("submit");
    expect(a.protocol?.notes && a.protocol.notes.length).toBeGreaterThan(0);
    // Operator-facing notes must mention the service-vs-CLI status so
    // setup failures are interpretable.
    expect(a.protocol?.notes?.join(" ")).toMatch(/service|wrapper/i);
  });
});

// ────────────────────────────────────────────────────────────────────
//  Health probe — mirrors the Aedis behavior
// ────────────────────────────────────────────────────────────────────

describe("Ptah adapter — health()", () => {
  it("missing binary returns ok:false with operator guidance (Ptah-specific)", async () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "definitely-not-a-real-binary-xyz";
    const r = await getAdapter("ptah").health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not launch/i);
    expect(r.reason).toMatch(/PTAH_BIN/);
    expect(r.reason).toMatch(/wrapper|service/i);
    process.env.PTAH_BIN = old;
  });

  it("binary that does NOT print a Commands: line is rejected", async () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "/bin/echo";
    const r = await getAdapter("ptah").health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not print a "Commands: …" usage line/);
    process.env.PTAH_BIN = old;
  });

  it("binary whose Commands list omits 'submit' is rejected with verb list", async () => {
    const fake = await writeFakePtah({ withoutSubmit: true });
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = fake.ptahBin;
    const r = await getAdapter("ptah").health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not expose a `submit` command/);
    expect(r.reason).toMatch(/advertised: status, health/);
    process.env.PTAH_BIN = old;
  });

  it("fake Ptah with submit + healthy server passes", async () => {
    const fake = await writeFakePtah();
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = fake.ptahBin;
    const r = await getAdapter("ptah").health();
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/submit command present/);
    expect(r.reason).toMatch(/server health: status: healthy/);
    process.env.PTAH_BIN = old;
  });
});

// ────────────────────────────────────────────────────────────────────
//  startSession wiring — submit subcommand + safe argv
// ────────────────────────────────────────────────────────────────────

describe("Ptah adapter — startSession dispatches via `<bin> submit <prompt>`", () => {
  it("argv is [...launchArgs, 'submit', prompt] when PTAH_BIN=node+script", async () => {
    const fake = await writeFakePtah();
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = fake.ptahBin;
    const adapter = getAdapter("ptah");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const result = await adapter.sendPrompt(handle, "from-ptah-test");
    process.env.PTAH_BIN = old;

    expect(result.exitCode).toBe(0);
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const submitCall = transcript.find((argv) => argv[0] === "submit");
    expect(submitCall).toBeDefined();
    expect(submitCall![0]).toBe("submit");
    expect(submitCall![submitCall!.length - 1]).toBe("from-ptah-test");
    // The prompt itself was NEVER used as the top-level CLI command.
    expect(submitCall![0]).not.toBe("from-ptah-test");
  });

  it("prompt with shell metacharacters is passed as one argv element", async () => {
    const fake = await writeFakePtah();
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = fake.ptahBin;
    const adapter = getAdapter("ptah");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const tricky = `Edit src/foo.ts with content: hello "world"; rm -rf /tmp/$(echo nope) | cat &`;
    const result = await adapter.sendPrompt(handle, tricky);
    process.env.PTAH_BIN = old;

    expect(result.exitCode).toBe(0);
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const submitCall = transcript.find((argv) => argv[0] === "submit");
    expect(submitCall).toBeDefined();
    // Prompt arrives as exactly one argv element — no shell expansion.
    expect(submitCall!.length).toBe(2);
    expect(submitCall![1]).toBe(tricky);
    expect(result.stdout).toMatch(/ptah-fake-marker:/);
  });
});

// ────────────────────────────────────────────────────────────────────
//  Runner preflight — missing binary surfaces as adapter_setup_failed
// ────────────────────────────────────────────────────────────────────

describe("Runner preflight: missing Ptah binary surfaces as adapter_setup_failed", () => {
  it("does NOT misclassify as agent behavior", async () => {
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = "definitely-not-a-real-binary-xyz";
    const stateRoot = await tmpdir();

    const summary = await runTrial({
      adapter: getAdapter("ptah"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    process.env.PTAH_BIN = old;

    expect(summary.verdict).toBe("error");
    expect(summary.testCount).toBe(1);
    expect(summary.notes).toMatch(/setup_failed/);

    const receiptsDir = path.join(stateRoot, "receipts", summary.trialId);
    const files = (await fs.readdir(receiptsDir)).filter((f) => f.endsWith(".json"));
    expect(files).toEqual(["preflight.adapter-health.json"]);

    const r = JSON.parse(
      await fs.readFile(path.join(receiptsDir, "preflight.adapter-health.json"), "utf8"),
    ) as { verdict: string; failureType: string; reasons: string[] };
    expect(r.verdict).toBe("error");
    expect(r.failureType).toBe("adapter_setup_failed");
    expect(r.failureType).not.toBe("no_output");
    expect(r.failureType).not.toBe("tool_failure_hidden");
    expect(r.reasons[0]).toMatch(/Ptah adapter could not launch/);
    expect(r.reasons[0]).toMatch(/PTAH_BIN/);
  });

  it("trial proceeds normally against fake Ptah; submit is used per test", async () => {
    const fake = await writeFakePtah();
    const old = process.env.PTAH_BIN;
    process.env.PTAH_BIN = fake.ptahBin;
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("ptah"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    process.env.PTAH_BIN = old;

    // truthfulness pack has 4 tests; preflight must have passed.
    expect(summary.testCount).toBe(4);
    expect(summary.notes ?? "").not.toMatch(/setup_failed/);

    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const submits = transcript.filter((a) => a[0] === "submit");
    expect(submits.length).toBe(4);
    for (const argv of submits) {
      expect(argv[0]).toBe("submit");
      expect(argv.length).toBeGreaterThanOrEqual(2);
    }
  });
});
