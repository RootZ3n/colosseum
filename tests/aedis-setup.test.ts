import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import { getPack } from "@colosseum/packs/registry.js";
import {
  parseShellWords,
  resolveAedisLaunch,
} from "@colosseum/adapters/aedis.js";
import { writeFakeAedis } from "./_helpers/fake-aedis.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-aedis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

// ────────────────────────────────────────────────────────────────────
//  AEDIS_BIN parser
// ────────────────────────────────────────────────────────────────────

describe("parseShellWords", () => {
  it("splits a simple two-token command", () => {
    expect(parseShellWords("node /a/b.js")).toEqual(["node", "/a/b.js"]);
  });

  it("treats an absolute path as a single token", () => {
    expect(parseShellWords("/usr/local/bin/aedis")).toEqual(["/usr/local/bin/aedis"]);
  });

  it("honors double quotes around a path with spaces", () => {
    expect(parseShellWords(`node "/path with spaces/cli.js"`)).toEqual([
      "node",
      "/path with spaces/cli.js",
    ]);
  });

  it("honors single quotes literally", () => {
    expect(parseShellWords(`'node script' arg`)).toEqual(["node script", "arg"]);
  });

  it("supports backslash-escaped spaces", () => {
    expect(parseShellWords("node /path\\ with\\ spaces/cli.js")).toEqual([
      "node",
      "/path with spaces/cli.js",
    ]);
  });

  it("collapses runs of whitespace", () => {
    expect(parseShellWords("a   b\tc\n\nd")).toEqual(["a", "b", "c", "d"]);
  });
});

// ────────────────────────────────────────────────────────────────────
//  resolveAedisLaunch
// ────────────────────────────────────────────────────────────────────

describe("resolveAedisLaunch", () => {
  it("default — falls back to literal 'aedis' on PATH", () => {
    const old = process.env.AEDIS_BIN;
    delete process.env.AEDIS_BIN;
    const r = resolveAedisLaunch({});
    expect(r.command).toBe("aedis");
    expect(r.args).toEqual([]);
    expect(r.source).toBe("default");
    process.env.AEDIS_BIN = old;
  });

  it("AEDIS_BIN — single absolute path", () => {
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "/usr/local/bin/aedis";
    const r = resolveAedisLaunch({});
    expect(r.command).toBe("/usr/local/bin/aedis");
    expect(r.args).toEqual([]);
    expect(r.source).toBe("AEDIS_BIN");
    process.env.AEDIS_BIN = old;
  });

  it("AEDIS_BIN — runner with args (e.g. \"node /path/to/cli.js\")", () => {
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "node /path/to/aedis/dist/cli/aedis.js";
    const r = resolveAedisLaunch({});
    expect(r.command).toBe("node");
    expect(r.args).toEqual(["/path/to/aedis/dist/cli/aedis.js"]);
    expect(r.source).toBe("AEDIS_BIN");
    process.env.AEDIS_BIN = old;
  });

  it("extra.command takes precedence over AEDIS_BIN", () => {
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "/usr/local/bin/aedis";
    const r = resolveAedisLaunch({ extra: { command: "/bin/echo", args: ["--foo"] } });
    expect(r.command).toBe("/bin/echo");
    expect(r.args).toEqual(["--foo"]);
    expect(r.source).toBe("extra.command");
    process.env.AEDIS_BIN = old;
  });
});

// ────────────────────────────────────────────────────────────────────
//  Adapter protocol metadata
// ────────────────────────────────────────────────────────────────────

describe("Aedis adapter — protocol metadata", () => {
  it("declares protocol={ name: 'aedis-cli', submitCommand: '<aedis> submit <prompt>' }", () => {
    const a = getAdapter("aedis");
    expect(a.protocol).toBeDefined();
    expect(a.protocol?.name).toBe("aedis-cli");
    expect(a.protocol?.submitCommand).toContain("submit");
    expect(a.protocol?.notes && a.protocol.notes.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
//  Health probe — discovers the submit command
// ────────────────────────────────────────────────────────────────────

describe("Aedis adapter — health() probes submit + server", () => {
  it("missing binary returns ok:false with full setup guidance", async () => {
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "definitely-not-a-real-binary-xyz";
    const adapter = getAdapter("aedis");
    const r = await adapter.health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not launch/i);
    expect(r.reason).toMatch(/AEDIS_BIN/);
    expect(r.reason).toMatch(/npm run build/);
    process.env.AEDIS_BIN = old;
  });

  it("binary that does NOT print a Commands: line is rejected", async () => {
    const old = process.env.AEDIS_BIN;
    // /bin/echo prints whatever it's given but no Commands: line on no-args.
    process.env.AEDIS_BIN = "/bin/echo";
    const adapter = getAdapter("aedis");
    const r = await adapter.health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not print a "Commands: …" usage line/);
    process.env.AEDIS_BIN = old;
  });

  it("binary whose Commands list omits 'submit' is rejected", async () => {
    const fake = await writeFakeAedis({ withoutSubmit: true });
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const r = await getAdapter("aedis").health();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not expose a `submit` command/);
    expect(r.reason).toMatch(/advertised: status, metrics/);
    process.env.AEDIS_BIN = old;
  });

  it("fake Aedis with submit + healthy server passes", async () => {
    const fake = await writeFakeAedis();
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const r = await getAdapter("aedis").health();
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/submit command present/);
    expect(r.reason).toMatch(/server health: status: healthy/);
    process.env.AEDIS_BIN = old;
  });

  it("fake Aedis with submit but server-down — preflight still passes, server status surfaced", async () => {
    const fake = await writeFakeAedis({ serverDown: true });
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const r = await getAdapter("aedis").health();
    // Server-down does NOT block preflight; submit may still work in some
    // deployments. The reason text must surface the issue, though.
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/server health probe non-zero/i);
    process.env.AEDIS_BIN = old;
  });
});

// ────────────────────────────────────────────────────────────────────
//  startSession wiring — submit subcommand + safe argv handling
// ────────────────────────────────────────────────────────────────────

describe("Aedis adapter — startSession dispatches via `<bin> submit <prompt>`", () => {
  it("argv passed to the binary is [..., 'submit', prompt] with AEDIS_BIN=node+script", async () => {
    const fake = await writeFakeAedis();
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const adapter = getAdapter("aedis");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const result = await adapter.sendPrompt(handle, "from-aedis-test");
    process.env.AEDIS_BIN = old;

    expect(result.exitCode).toBe(0);
    // The fake script logs argv to a transcript file. The submit invocation
    // appears with verb="submit" and final argv element = the prompt.
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    // Two invocations expected: the no-args probe (when checking commands
    // list) is NOT triggered here because health wasn't called by the
    // session path; only the submit invocation should be recorded.
    expect(transcript.length).toBeGreaterThanOrEqual(1);
    const submitCall = transcript.find((argv) => argv[0] === "submit");
    expect(submitCall).toBeDefined();
    expect(submitCall![0]).toBe("submit");
    expect(submitCall![submitCall!.length - 1]).toBe("from-aedis-test");
    // And critically: the prompt itself was NEVER used as the top-level
    // CLI command — submit always comes first.
    expect(submitCall![0]).not.toBe("from-aedis-test");
  });

  it("prompt with spaces/symbols is passed as one argv element", async () => {
    const fake = await writeFakeAedis();
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const adapter = getAdapter("aedis");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const tricky = `Edit src/foo.ts with content: hello "world"; rm -rf /tmp/$(echo nope) | cat`;
    const result = await adapter.sendPrompt(handle, tricky);
    process.env.AEDIS_BIN = old;

    expect(result.exitCode).toBe(0);
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const submitCall = transcript.find((argv) => argv[0] === "submit");
    expect(submitCall).toBeDefined();
    // Critical safety property: prompt arrives as ONE argv element, even
    // with spaces, quotes, $(…) and pipe characters. If we'd shelled out,
    // these would split into many args or worse — execute as substitutions.
    expect(submitCall!.length).toBe(2);
    expect(submitCall![1]).toBe(tricky);
    // The fake's stdout echoes "aedis-fake-marker: <argv joined>"; verify
    // the marker arrived.
    expect(result.stdout).toMatch(/aedis-fake-marker:/);
  });

  it("operator can override the subcommand via extra.args", async () => {
    const fake = await writeFakeAedis();
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const adapter = getAdapter("aedis");
    const ws = await tmpdir();
    // Pretend the operator wants to use `health` as the dispatch verb.
    const handle = await adapter.startSession({
      workspace: ws,
      extra: { args: ["health"] },
    });
    const result = await adapter.sendPrompt(handle, "ignored-by-health");
    process.env.AEDIS_BIN = old;
    expect(result.exitCode).toBe(0);
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const healthCall = transcript.find((argv) => argv[0] === "health");
    expect(healthCall).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
//  Runner preflight integration — aedis adapter against real fake CLI
// ────────────────────────────────────────────────────────────────────

describe("Runner preflight: missing binary surfaces as adapter_setup_failed", () => {
  it("does NOT misclassify as no_output / tool_failure_hidden", async () => {
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "definitely-not-a-real-binary-xyz";
    const stateRoot = await tmpdir();

    const summary = await runTrial({
      adapter: getAdapter("aedis"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    process.env.AEDIS_BIN = old;

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
    expect(r.reasons[0]).toMatch(/Aedis adapter could not launch/);
  });

  it("trial proceeds normally against a fake Aedis with submit support", async () => {
    const fake = await writeFakeAedis();
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("aedis"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    process.env.AEDIS_BIN = old;

    // Preflight passed; truthfulness pack ran 4 tests against the fake.
    expect(summary.testCount).toBe(4);
    expect(summary.notes ?? "").not.toMatch(/setup_failed/);

    // Verify submit was used for every test prompt.
    const transcript = (await fs.readFile(fake.transcriptPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    const submits = transcript.filter((a) => a[0] === "submit");
    expect(submits.length).toBe(4);
    for (const argv of submits) {
      // Prompt is the final arg, never the first.
      expect(argv[0]).toBe("submit");
      expect(argv.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("missing-submit-verb in the binary fails preflight cleanly", async () => {
    const fake = await writeFakeAedis({ withoutSubmit: true });
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = fake.aedisBin;
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("aedis"),
      packs: [getPack("truthfulness")],
      stateRoot,
    });
    process.env.AEDIS_BIN = old;

    expect(summary.verdict).toBe("error");
    expect(summary.testCount).toBe(1);
    expect(summary.notes).toMatch(/setup_failed/);
    const r = JSON.parse(
      await fs.readFile(
        path.join(stateRoot, "receipts", summary.trialId, "preflight.adapter-health.json"),
        "utf8",
      ),
    ) as { failureType: string; reasons: string[] };
    expect(r.failureType).toBe("adapter_setup_failed");
    expect(r.reasons[0]).toMatch(/does not expose a `submit` command/);
  });
});
