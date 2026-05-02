import { describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runTrial } from "@colosseum/runner/trial-runner.js";
import { trialsRouter } from "@colosseum/api/routes/trials.js";
import type { AgentAdapter } from "@colosseum/adapters/types.js";
import type { TestPack } from "@colosseum/packs/types.js";
import type { AgentEvent, AgentRunResult, TrialEvent } from "@colosseum/types.js";
import { getAdapter } from "@colosseum/adapters/registry.js";
import { getPack } from "@colosseum/packs/registry.js";
import { TrialStore } from "@colosseum/storage/index.js";

async function tmpdir(): Promise<string> {
  const d = path.join(os.tmpdir(), `colosseum-live-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

function oneTestPack(): TestPack {
  return {
    id: "livepack",
    version: "1.0.0",
    title: "Live Pack",
    description: "Synthetic live event pack.",
    tests: [
      {
        id: "livepack.one",
        title: "One",
        description: "agent answers",
        category: "stamina",
        severity: "medium",
        prompt: () => "answer cleanly",
        assert: async (_ctx, run) => ({
          testId: "livepack.one",
          verdict: run.finalAnswer ? "pass" : "fail",
          severity: "medium",
          score: run.finalAnswer ? 1 : 0,
          reasons: run.finalAnswer ? ["answered"] : ["no answer"],
          evidence: [{ label: "answer", detail: run.finalAnswer ?? "" }],
          failureType: run.finalAnswer ? undefined : "no_output",
        }),
      },
    ],
  };
}

function streamingAdapter(): AgentAdapter {
  const events: AgentEvent[] = [];
  let release: (() => void) | undefined;
  return {
    id: "streamer",
    version: "1.0.0",
    name: "Streamer",
    description: "Synthetic streaming adapter",
    capabilities: {
      streaming: true,
      toolUse: true,
      fileEditing: false,
      shellExecution: false,
      modelSelection: false,
      reportsCost: true,
      reportsTokens: true,
    },
    truth: {
      modelIdentity: "declared",
      costTruth: "reported",
      eventStructure: "structured",
      toolSupport: true,
    },
    async health() {
      return { ok: true };
    },
    async startSession(opts) {
      return {
        sessionId: "streamer-session",
        workspace: opts.workspace,
        modelInfo: {
          model: "stream-model",
          provider: "stream-provider",
          location: "local",
          adapterVersion: "1.0.0",
        },
      };
    },
    async sendPrompt(handle): Promise<AgentRunResult> {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const ev = {
        ts: Date.now(),
        kind: "thought",
        text: "live step with sk-ant-123456789012345678901234",
      };
      events.push(ev);
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        events: [ev],
        artifacts: [],
        exitCode: 0,
        modelInfo: handle.modelInfo,
        costInfo: { reported: true, totalTokens: 2, estimatedCostUsd: 0 },
        durationMs: 60,
        stdout: "ok",
        stderr: "",
        finalAnswer: "ok",
      };
    },
    async *streamEvents() {
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      for (const ev of events) yield ev;
    },
    async stop() {},
    async collectArtifacts() {
      return [];
    },
    async getModelInfo(handle) {
      return handle.modelInfo;
    },
    async getCostInfo() {
      return { reported: true, totalTokens: 2, estimatedCostUsd: 0 };
    },
  };
}

function nonStreamingAdapter(): AgentAdapter {
  return {
    ...streamingAdapter(),
    id: "nostream",
    name: "No Stream",
    capabilities: {
      streaming: false,
      toolUse: false,
      fileEditing: false,
      shellExecution: false,
      modelSelection: false,
      reportsCost: true,
      reportsTokens: true,
    },
    streamEvents: undefined,
    async sendPrompt(handle): Promise<AgentRunResult> {
      return {
        events: [{ ts: Date.now(), kind: "final", text: "ok" }],
        artifacts: [],
        exitCode: 0,
        modelInfo: handle.modelInfo,
        costInfo: { reported: true, totalTokens: 2, estimatedCostUsd: 0 },
        durationMs: 1,
        stdout: "ok",
        stderr: "",
        finalAnswer: "ok",
      };
    },
  };
}

async function startApp(stateRoot: string) {
  const app = express();
  app.use(express.json());
  app.use("/api/trials", trialsRouter(stateRoot));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind tcp");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

async function readSse(url: string): Promise<TrialEvent[]> {
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as TrialEvent);
}

describe("live trial events", () => {
  it("consumes adapter streamEvents while sendPrompt is still running", async () => {
    const stateRoot = await tmpdir();
    const seen: TrialEvent[] = [];
    const summary = await runTrial({
      adapter: streamingAdapter(),
      packs: [oneTestPack()],
      stateRoot,
      onEvent: (e) => seen.push(e),
    });
    expect(summary.verdict).toBe("pass");
    const adapterEvent = seen.find((e) => e.phase === "adapter_event" && e.source === "adapter");
    const complete = seen.find((e) => e.phase === "complete");
    expect(adapterEvent).toBeDefined();
    expect(complete).toBeDefined();
    expect(adapterEvent!.sequence).toBeLessThan(complete!.sequence);
    expect(adapterEvent!.message).toContain("[REDACTED:anthropic_api_key]");
    expect(adapterEvent!.message).not.toContain("sk-ant-123456789012345678901234");
    expect(summary.score.trust).toBeGreaterThan(0);
  });

  it("keeps non-streaming adapters working and marks buffered mode", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: nonStreamingAdapter(),
      packs: [oneTestPack()],
      stateRoot,
    });
    expect(summary.liveMode).toBe("buffered");
    expect(summary.verdict).toBe("pass");
  });

  it("persists completed timelines for replay", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("stamina")],
      stateRoot,
    });
    const events = await new TrialStore(stateRoot).getTrialEvents(summary.trialId);
    expect(events.length).toBeGreaterThan(4);
    expect(events[0].sequence).toBe(1);
    expect(events.at(-1)?.phase).toBe("complete");
  });

  it("SSE endpoint replays completed trial events in order", async () => {
    const stateRoot = await tmpdir();
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("stamina")],
      stateRoot,
    });
    const app = await startApp(stateRoot);
    try {
      const events = await readSse(`${app.baseUrl}/api/trials/${summary.trialId}/events`);
      expect(events.length).toBeGreaterThan(4);
      expect(events.map((e) => e.sequence)).toEqual(
        [...events].map((e) => e.sequence).sort((a, b) => a - b),
      );
      expect(events.every((e) => e.mode === "replay")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("SSE endpoint emits ordered events for a newly started trial", async () => {
    const stateRoot = await tmpdir();
    const app = await startApp(stateRoot);
    try {
      const started = await fetch(`${app.baseUrl}/api/trials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "mock", packs: ["stamina"] }),
      });
      expect(started.status).toBe(202);
      const { trialId } = await started.json() as { trialId: string };
      const events = await readSse(`${app.baseUrl}/api/trials/${trialId}/events`);
      expect(events.length).toBeGreaterThan(4);
      expect(events.at(-1)?.phase).toBe("complete");
      expect(events.map((e) => e.sequence)).toEqual(
        [...events].map((e) => e.sequence).sort((a, b) => a - b),
      );
    } finally {
      await app.close();
    }
  });

  it("mock + stamina first-run path produces visible lifecycle events without changing scoring", async () => {
    const stateRoot = await tmpdir();
    const seen: TrialEvent[] = [];
    const summary = await runTrial({
      adapter: getAdapter("mock"),
      packs: [getPack("stamina")],
      stateRoot,
      onEvent: (e) => seen.push(e),
    });
    expect(summary.verdict).toBe("pass");
    expect(summary.score.trust).toBe(1);
    expect(seen.some((e) => e.phase === "test_started")).toBe(true);
    expect(seen.some((e) => e.phase === "receipt_written")).toBe(true);
    expect(seen.some((e) => e.phase === "complete")).toBe(true);
  });
});
