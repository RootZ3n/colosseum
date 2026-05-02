import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  streamTrialEvents,
  type AgentSummary,
  type PackSummary,
  type TrialEvent,
} from "../api.js";
import { ArenaTimeline, type TimelineEntry } from "../components/ArenaTimeline.js";
import { ArenaRails, SectionDivider } from "../components/ArenaRails.js";

type AdapterTruthShape = {
  modelIdentity: string;
  costTruth: string;
  eventStructure: string;
  toolSupport: boolean;
};

export function NewTrial() {
  const nav = useNavigate();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [agent, setAgent] = useState("mock");
  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [location, setLocation] = useState<"local" | "cloud" | "unknown">("unknown");
  const [running, setRunning] = useState(false);
  const [trialId, setTrialId] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEntry[]>([]);
  const [liveEvents, setLiveEvents] = useState<TrialEvent[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.agents().then(setAgents);
    api.packs().then((p) => {
      setPacks(p);
      // Match the documented beginner smoke path. The mock agent intentionally
      // fails parts of truthfulness, so "all packs" is a poor first click.
      setSelectedPacks(p.some((x) => x.id === "stamina") ? ["stamina"] : p.map((x) => x.id));
    });
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === agent),
    [agents, agent],
  );

  // /api/agents returns the adapter's declared truth contract directly —
  // no heuristics here, just render what the adapter said about itself.
  // Fallback covers the rare case the endpoint omits the field.
  const truth: AdapterTruthShape = useMemo(() => {
    const t = selectedAgent?.truth;
    if (t) return t;
    return {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: !!selectedAgent?.capabilities?.toolUse,
    };
  }, [selectedAgent]);

  const honestUnknown =
    truth.modelIdentity === "unknown" || truth.costTruth === "unknown";
  const latest = liveEvents[liveEvents.length - 1];
  const latestCritical = [...liveEvents].reverse().find((e) => e.severity === "critical");
  const currentTest = [...liveEvents].reverse().find((e) => e.testId)?.testId;
  const currentPack = [...liveEvents].reverse().find((e) => e.packId)?.packId;
  const currentModel = [...liveEvents].reverse().find((e) => e.model)?.model;
  const streamMode =
    latest?.mode ?? (selectedAgent?.capabilities?.streaming ? "live" : "buffered");
  const elapsedMs = startedAt ? now - startedAt : 0;

  async function start() {
    setRunning(true);
    setEvents([]);
    setLiveEvents([]);
    setTrialId(null);
    setStartedAt(Date.now());
    try {
      const { trialId } = await api.startTrial({
        agent,
        packs: selectedPacks,
        model: model || undefined,
        location,
      });
      setTrialId(trialId);
      const stop = streamTrialEvents(trialId, (e) => {
        setLiveEvents((prev) => [...prev.slice(-199), e]);
        setEvents((prev) => [
          ...prev.slice(-199),
          { ts: e.timestamp, kind: `${e.phase}.${e.severity}`, text: e.message },
        ]);
        if (e.phase === "complete") {
          stop();
          setRunning(false);
          setTimeout(() => nav(`/trial/${trialId}`), 900);
        }
      });
    } catch (err) {
      setEvents((prev) => [
        ...prev,
        { ts: Date.now(), kind: "error", text: String((err as Error).message) },
      ]);
      setRunning(false);
    }
  }

  function togglePack(id: string) {
    setSelectedPacks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="page">
      <ArenaRails />

      <div className="dais" style={{ marginBottom: 22 }}>
        <div className="eyebrow">New Trial</div>
        <h2>Open the Gates</h2>
        <div className="muted" style={{ marginTop: 6, letterSpacing: "0.04em" }}>
          Choose your agent. Pick the packs. Set the model. Watch the floor.
        </div>
      </div>

      <SectionDivider label="The Combatant" />

      <div className="pack-grid" style={{ marginBottom: 18 }}>
        {agents.map((a) => {
          const on = a.id === agent;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAgent(a.id)}
              className={`pack-tile tile-clickable${on ? " selected" : ""}`}
              disabled={running}
              aria-pressed={on}
              style={{ textAlign: "left", color: "inherit", borderWidth: 1, font: "inherit" }}
            >
              <div className="tile-eyebrow">Adapter</div>
              <h3>{a.name}</h3>
              <div className="tile-body">{a.description}</div>
              <div className="tile-foot">
                <span className="mono">{a.id}</span>
                <span>{on ? "selected" : "select →"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Adapter truth contract banner */}
      <div className="adapter-truth">
        <div className="field">
          <span className="label">Model identity</span>
          <span className={`value ${truth.modelIdentity}`}>{truth.modelIdentity}</span>
        </div>
        <div className="field">
          <span className="label">Cost truth</span>
          <span className={`value ${truth.costTruth}`}>{truth.costTruth}</span>
        </div>
        <div className="field">
          <span className="label">Event structure</span>
          <span className={`value ${truth.eventStructure}`}>{truth.eventStructure}</span>
        </div>
        <div className="field">
          <span className="label">Tool support</span>
          <span className="value">{truth.toolSupport ? "yes" : "no"}</span>
        </div>
      </div>
      {honestUnknown && (
        <div className="adapter-truth-note">
          Unknown is honest. This adapter does not report that field — receipts will say so plainly rather than fabricate a value.
        </div>
      )}

      {selectedAgent?.protocol && (
        <div
          className="adapter-truth-note"
          style={{ fontStyle: "normal", marginTop: 4 }}
        >
          <strong style={{ color: "var(--gold-2)", letterSpacing: "0.04em" }}>
            Protocol: {selectedAgent.protocol.name}
          </strong>
          {selectedAgent.protocol.submitCommand && (
            <>
              {" — dispatches via "}
              <code
                className="mono"
                style={{
                  background: "var(--stone-3)",
                  padding: "1px 6px",
                  borderRadius: 3,
                  border: "1px solid var(--stone-edge)",
                }}
              >
                {selectedAgent.protocol.submitCommand}
              </code>
            </>
          )}
          {selectedAgent.protocol.notes &&
            selectedAgent.protocol.notes.length > 0 && (
              <ul
                style={{
                  margin: "6px 0 0 16px",
                  padding: 0,
                  listStyle: "disc",
                }}
              >
                {selectedAgent.protocol.notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 12 }}>{n}</li>
                ))}
              </ul>
            )}
        </div>
      )}

      <SectionDivider label="The Trials" />

      <div className="pack-grid" style={{ marginBottom: 18 }}>
        {packs.map((p) => {
          const on = selectedPacks.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePack(p.id)}
              className={`pack-tile tile-clickable${on ? " selected" : ""}`}
              disabled={running}
              aria-pressed={on}
              style={{ textAlign: "left", color: "inherit", borderWidth: 1, font: "inherit" }}
            >
              <div className="tile-eyebrow">Pack</div>
              <h3>{p.title}</h3>
              <div className="tile-body">{p.description}</div>
              <div className="tile-foot">
                <span>{p.tests.length} test{p.tests.length === 1 ? "" : "s"}</span>
                <span>{on ? "✓ selected" : "select"}</span>
              </div>
            </button>
          );
        })}
      </div>

      <SectionDivider label="Conditions" />

      <div className="cols">
        <div className="stone">
          <h2 style={{ marginTop: 0 }}>Configuration</h2>
          <label className="field">
            <span>Model (optional)</span>
            <input
              className="input"
              placeholder="e.g. claude-sonnet-4-6, llama3:70b"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={running}
            />
          </label>
          <label className="field">
            <span>Location</span>
            <select
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value as any)}
              disabled={running}
            >
              <option value="unknown">unknown (let the adapter decide)</option>
              <option value="local">local</option>
              <option value="cloud">cloud</option>
            </select>
          </label>
          <button
            className="btn"
            onClick={start}
            disabled={running || selectedPacks.length === 0}
          >
            {running ? "In the arena…" : "▶ Begin trial"}
          </button>
        </div>

        <div className="stone" style={{ gridColumn: "span 2" }}>
          <div className="arena-live-head">
            <div>
              <div className="eyebrow">Arena Floor</div>
              <h2 style={{ margin: 0 }}>Live Trial</h2>
            </div>
            <span className={`live-badge ${streamMode}`}>
              {streamMode === "live" ? "LIVE" : streamMode === "replay" ? "REPLAY" : "BUFFERED"}
            </span>
          </div>
          {latestCritical && (
            <div className="critical-banner">{latestCritical.message}</div>
          )}
          <div className="live-grid">
            <div>
              <span>Phase</span>
              <strong>{latest?.phase.replace(/_/g, " ") ?? (running ? "queued" : "idle")}</strong>
            </div>
            <div>
              <span>Current test</span>
              <strong>{currentTest ?? "pending"}</strong>
            </div>
            <div>
              <span>Pack</span>
              <strong>{currentPack ?? (selectedPacks.join(", ") || "pending")}</strong>
            </div>
            <div>
              <span>Adapter</span>
              <strong>{selectedAgent?.id ?? agent}</strong>
            </div>
            <div>
              <span>Provider/model</span>
              <strong>
                {currentModel
                  ? `${currentModel.provider} · ${currentModel.model}`
                  : "pending identity"}
              </strong>
            </div>
            <div>
              <span>Elapsed</span>
              <strong>{running ? `${(elapsedMs / 1000).toFixed(1)}s` : "0.0s"}</strong>
            </div>
            <div>
              <span>Trust</span>
              <strong>{latest?.phase === "complete" ? "scored" : "pending scoring"}</strong>
            </div>
          </div>
          {streamMode === "buffered" && (
            <div className="adapter-truth-note" style={{ margin: "10px 0" }}>
              This adapter does not provide live step events; showing trial status and receipt timeline.
            </div>
          )}
          {trialId && (
            <div className="muted mono" style={{ marginBottom: 8 }}>
              Trial: {trialId}
            </div>
          )}
          <ArenaTimeline entries={events} />
        </div>
      </div>
    </div>
  );
}
