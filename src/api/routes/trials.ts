import { Router } from "express";
import { getAdapter } from "../../adapters/registry.js";
import { getPack } from "../../packs/registry.js";
import { runTrial } from "../../runner/trial-runner.js";
import { TrialStore } from "../../storage/index.js";
import { COLOSSEUM_VERSION, getGitCommit } from "../../version.js";
import type { TrialEvent } from "../../types.js";

interface LiveTrial {
  trialId: string;
  events: TrialEvent[];
  done: boolean;
  /** SSE clients listening on this trial. */
  clients: Set<(e: TrialEvent) => void>;
}

export function trialsRouter(stateRoot: string): Router {
  const r = Router();
  const live = new Map<string, LiveTrial>();
  const store = new TrialStore(stateRoot);
  const maxLiveEvents = 1_000;

  r.get("/", async (_req, res) => {
    const trials = await store.listTrials();
    res.json({ trials });
  });

  r.post("/", async (req, res) => {
    const body = req.body as {
      agent: string;
      packs: string[];
      model?: string;
      location?: "local" | "cloud" | "unknown";
      extra?: Record<string, unknown>;
    };
    if (!body?.agent || !Array.isArray(body.packs) || body.packs.length === 0) {
      res.status(400).json({ error: "agent and packs[] are required" });
      return;
    }
    let adapter, packs;
    try {
      adapter = getAdapter(body.agent);
      packs = body.packs.map(getPack);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    const trialId = `trial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slot: LiveTrial = { trialId, events: [], done: false, clients: new Set() };
    live.set(trialId, slot);
    const pushLive = (e: TrialEvent) => {
      slot.events.push(e);
      if (slot.events.length > maxLiveEvents) {
        slot.events.splice(0, slot.events.length - maxLiveEvents);
      }
      for (const c of slot.clients) c(e);
      if (e.phase === "complete") slot.done = true;
    };

    runTrial({
      trialId,
      adapter,
      packs,
      stateRoot,
      baseRunOptions: {
        model: body.model,
        location: body.location,
        extra: body.extra,
      },
      onEvent: (e) => {
        pushLive(e);
      },
    }).catch((err) => {
      const now = Date.now();
      pushLive({
        sequence: slot.events.length + 1,
        trialId,
        timestamp: now,
        phase: "complete",
        severity: "critical",
        message: `Runner error: ${(err as Error).message}`,
        adapter: { id: body.agent, version: "unknown" },
        source: "runner",
        mode: "buffered",
      });
      slot.done = true;
      void store.saveTrial({
        trialId,
        agentId: body.agent,
        adapter: body.agent,
        packs: body.packs,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        verdict: "error",
        score: {
          passRate: 0,
          perCategory: [],
          costEfficiency: { category: "overall", value: 0, n: 0, reasons: [] },
          trust: 0,
          reasons: [`Runner error: ${(err as Error).message}`],
        },
        testCount: 0,
        passCount: 0,
        failCount: 0,
        velumDecision: "warn",
        colosseumVersion: COLOSSEUM_VERSION,
        gitCommit: getGitCommit(),
        adapterVersion: "unknown",
        packVersions: Object.fromEntries(body.packs.map((p) => [p, "unknown"])),
        adapterTruth: {
          modelIdentity: "unknown",
          costTruth: "unknown",
          eventStructure: "unstructured",
          toolSupport: false,
        },
        liveMode: "buffered",
        eventCount: slot.events.length,
      });
      void store.saveTrialEvents(trialId, slot.events);
    });

    res.status(202).json({ trialId });
  });

  r.get("/:id", async (req, res) => {
    const summary = await store.getTrial(req.params.id);
    if (!summary) {
      res.status(404).json({ error: "no such trial" });
      return;
    }
    res.json(summary);
  });

  r.get("/:id/events", async (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const slot = live.get(req.params.id);
    if (!slot) {
      const saved = await store.getTrialEvents(req.params.id);
      if (saved.length === 0) {
        const summary = await store.getTrial(req.params.id);
        if (!summary) {
          res.write(`event: error\ndata: {"error":"no such trial"}\n\n`);
          res.end();
          return;
        }
      }
      for (const e of saved) {
        res.write(`data: ${JSON.stringify({ ...e, mode: "replay" })}\n\n`);
      }
      res.end();
      return;
    }
    // Replay buffered events first.
    for (const e of slot.events) {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    }
    if (slot.done) {
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
      return;
    }
    const onEvent = (e: TrialEvent) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (e.phase === "complete") {
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
      }
    };
    slot.clients.add(onEvent);
    req.on("close", () => slot.clients.delete(onEvent));
  });

  return r;
}
