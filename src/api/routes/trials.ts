import { Router } from "express";
import { getAdapter } from "../../adapters/registry.js";
import { getPack } from "../../packs/registry.js";
import { runTrial, type TrialEvent } from "../../runner/trial-runner.js";
import { TrialStore } from "../../storage/index.js";
import { COLOSSEUM_VERSION, getGitCommit } from "../../version.js";

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
        slot.events.push(e);
        for (const c of slot.clients) c(e);
        if (e.kind === "trial:end") slot.done = true;
      },
    }).catch((err) => {
      slot.events.push({
        kind: "trial:end",
        trialId,
        // best-effort placeholder; UI will refetch the saved trial
        summary: {
          trialId,
          agentId: body.agent,
          adapter: body.agent,
          packs: body.packs,
          startedAt: Date.now(),
          finishedAt: Date.now(),
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
        },
      });
      slot.done = true;
      for (const c of slot.clients) c(slot.events[slot.events.length - 1]);
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

  r.get("/:id/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const slot = live.get(req.params.id);
    if (!slot) {
      res.write(`event: end\ndata: {"reason":"trial not active"}\n\n`);
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
      if (e.kind === "trial:end") {
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
      }
    };
    slot.clients.add(onEvent);
    req.on("close", () => slot.clients.delete(onEvent));
  });

  return r;
}
