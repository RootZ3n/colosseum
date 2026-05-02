import { promises as fs } from "node:fs";
import path from "node:path";
import type { TrialEvent, Verdict } from "../types.js";
import type { TrialScore } from "../scoring/score.js";
import type { AdapterTruthContract } from "../adapters/types.js";

/**
 * Filesystem layout for Colosseum state:
 *
 *   colosseum-state/
 *     trials/<trialId>.json
 *     trial-events/<trialId>.json
 *     receipts/<trialId>/<testId>.json
 *     receipts/<trialId>/<testId>.md
 *     fixtures/<trialId>/<testId>-<rand>/...     (per-test workspaces)
 *     artifacts/<trialId>/...                    (reserved)
 *     agents/                                    (reserved)
 *     reports/                                   (reserved)
 */
export interface TrialSummary {
  trialId: string;
  agentId: string;
  adapter: string;
  packs: string[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  verdict: Verdict;
  score: TrialScore;
  testCount: number;
  passCount: number;
  failCount: number;
  /** Velum aggregate decision across the whole trial. */
  velumDecision: "allow" | "warn" | "block" | "fail-test";
  /** Optional notes (e.g., model selection, location). */
  notes?: string;

  /* ------------------------------------------------------------------ */
  /*  Phase 1: truthfulness stamps                                       */
  /* ------------------------------------------------------------------ */

  /** Colosseum harness version at the time the trial ran. */
  colosseumVersion: string;
  /** Short git commit of the Colosseum repo. "unknown" if not in git. */
  gitCommit: string;
  /** Adapter version (declared by the adapter itself). */
  adapterVersion: string;
  /** Per-pack version map: { packId: version }. */
  packVersions: Record<string, string>;
  /** Adapter truth contract — copied onto the trial for audit. */
  adapterTruth: AdapterTruthContract;
  liveMode?: "live" | "buffered" | "replay";
  eventCount?: number;
}

export class TrialStore {
  constructor(public readonly stateRoot: string) {}

  async ensureLayout(): Promise<void> {
    for (const sub of [
      "trials",
      "receipts",
      "artifacts",
      "fixtures",
      "agents",
      "reports",
      "trial-events",
    ]) {
      await fs.mkdir(path.join(this.stateRoot, sub), { recursive: true });
    }
  }

  async saveTrial(t: TrialSummary): Promise<string> {
    await this.ensureLayout();
    const file = path.join(this.stateRoot, "trials", `${t.trialId}.json`);
    await fs.writeFile(file, JSON.stringify(t, null, 2));
    return file;
  }

  async listTrials(): Promise<TrialSummary[]> {
    await this.ensureLayout();
    const dir = path.join(this.stateRoot, "trials");
    const entries = await fs.readdir(dir).catch(() => []);
    const out: TrialSummary[] = [];
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      const txt = await fs.readFile(path.join(dir, e), "utf8").catch(() => "");
      if (!txt) continue;
      try {
        out.push(JSON.parse(txt));
      } catch {}
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  async getTrial(id: string): Promise<TrialSummary | null> {
    const file = path.join(this.stateRoot, "trials", `${id}.json`);
    const txt = await fs.readFile(file, "utf8").catch(() => "");
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  async saveTrialEvents(trialId: string, events: TrialEvent[]): Promise<string> {
    await this.ensureLayout();
    const file = path.join(this.stateRoot, "trial-events", `${trialId}.json`);
    await fs.writeFile(file, JSON.stringify(events, null, 2));
    return file;
  }

  async getTrialEvents(trialId: string): Promise<TrialEvent[]> {
    const file = path.join(this.stateRoot, "trial-events", `${trialId}.json`);
    const txt = await fs.readFile(file, "utf8").catch(() => "");
    if (!txt) return [];
    try {
      const parsed = JSON.parse(txt);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export function defaultStateRoot(): string {
  return path.resolve(process.cwd(), "colosseum-state");
}
