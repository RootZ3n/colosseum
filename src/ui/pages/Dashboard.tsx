import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AgentSummary, type PackSummary, type TrialSummary } from "../api.js";
import { VerdictPill } from "../components/VerdictPill.js";
import { ChampionBoard } from "../components/ChampionBoard.js";
import { ScoreBar } from "../components/ScoreBar.js";
import { ArenaRails, SectionDivider } from "../components/ArenaRails.js";
import { LaurelMark } from "../components/LaurelMark.js";

const PACK_ORDER = ["truthfulness", "safety", "repo-editing", "stamina", "local-model"];

const PACK_TAGLINES: Record<string, string> = {
  truthfulness: "Catches silent success and false completion claims.",
  safety: "Velum runs alongside — injection, secrets, destructive refusal.",
  "repo-editing": "Precise edits, scope discipline, contained artifacts.",
  stamina: "Multi-step, bounded retries, clean stops, long prompts.",
  "local-model": "Local-only stays local. No hidden cloud, no faked tokens.",
};

function HOW_STEPS() {
  return [
    {
      n: "I",
      title: "Adapter enters",
      body: "An AgentAdapter translates the agent into typed events and metadata.",
    },
    {
      n: "II",
      title: "Test pack runs",
      body: "Curated checks set up workspace fixtures and dispatch the prompt.",
    },
    {
      n: "III",
      title: "Velum inspects",
      body: "Prompt and output are scanned. Findings become evidence.",
    },
    {
      n: "IV",
      title: "Receipt proves",
      body: "JSON + Markdown record: who, what, why — every verdict justified.",
    },
    {
      n: "V",
      title: "Verdict lands",
      body: "Severity-aware roll-up. Trust score weights safety highest.",
    },
  ];
}

export function Dashboard() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [trials, setTrials] = useState<TrialSummary[]>([]);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.agents(), api.trials(), api.packs()])
      .then(([a, t, p]) => {
        setAgents(a);
        setTrials(t);
        setPacks(p);
      })
      .finally(() => setLoading(false));
  }, []);

  const safetyFails = trials.reduce(
    (sum, t) => sum + (t.velumDecision === "fail-test" ? 1 : 0),
    0,
  );
  const totalCost = 0;

  // Order packs canonically so the dashboard layout is stable.
  const orderedPacks = PACK_ORDER.map((id) => packs.find((p) => p.id === id)).filter(
    (x): x is PackSummary => !!x,
  );

  return (
    <div className="page">
      <ArenaRails />

      {/* ───── Hero ───── */}
      <section className="hero">
        <div>
          <h1>The Arena</h1>
          <p className="lede">
            Stop guessing if your agent works. Put it in the arena. Every trial
            produces a transparent receipt — model, cost, verdict, reasons —
            you can read, audit, and trust.
          </p>
          <div className="cta-row">
            <Link to="/new" className="btn">▶ New Trial</Link>
            <Link to="/trials" className="btn ghost">View Receipts</Link>
            <Link to="/packs" className="btn ghost">Test Packs</Link>
          </div>
        </div>
        <div className="hero-sigil" aria-hidden="true">
          <div className="crest"><LaurelMark /></div>
        </div>
      </section>

      {/* ───── Stats rail ───── */}
      <SectionDivider label="Arena Roster" />

      <div className="cols" style={{ marginBottom: 6 }}>
        <div className="stone">
          <div className="muted">Agents in the arena</div>
          <div style={{ fontSize: 36, fontFamily: "var(--serif)", color: "var(--gold-2)" }}>
            {agents.length}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            <Link to="/agents">Inspect</Link>
          </div>
        </div>
        <div className="stone">
          <div className="muted">Trials run</div>
          <div style={{ fontSize: 36, fontFamily: "var(--serif)", color: "var(--gold-2)" }}>
            {trials.length}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            <Link to="/trials">All trials</Link>
          </div>
        </div>
        <div className="stone">
          <div className="muted">Safety failures</div>
          <div
            style={{
              fontSize: 36,
              fontFamily: "var(--serif)",
              color: safetyFails ? "var(--crimson-soft)" : "var(--laurel-soft)",
            }}
          >
            {safetyFails}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Velum-flagged</div>
        </div>
        <div className="stone">
          <div className="muted">Reported cost</div>
          <div style={{ fontSize: 36, fontFamily: "var(--serif)", color: "var(--gold-2)" }}>
            ${totalCost.toFixed(2)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            "not reported" entries excluded
          </div>
        </div>
      </div>

      {/* ───── Trial Packs preview ───── */}
      <SectionDivider label="Trial Packs" />

      <div className="pack-grid" style={{ marginBottom: 6 }}>
        {orderedPacks.length === 0
          ? PACK_ORDER.map((id) => (
              <div key={id} className="pack-tile">
                <div className="tile-eyebrow">Pack</div>
                <h3 style={{ textTransform: "capitalize" }}>{id.replace("-", " ")}</h3>
                <div className="tile-body">{PACK_TAGLINES[id]}</div>
                <div className="tile-foot">
                  <span>—</span>
                  <Link to="/packs">read more →</Link>
                </div>
              </div>
            ))
          : orderedPacks.map((p) => (
              <div key={p.id} className="pack-tile">
                <div className="tile-eyebrow">Pack</div>
                <h3>{p.title}</h3>
                <div className="tile-body">{PACK_TAGLINES[p.id] ?? p.description}</div>
                <div className="tile-foot">
                  <span>{p.tests.length} test{p.tests.length === 1 ? "" : "s"}</span>
                  <Link to="/packs">read more →</Link>
                </div>
              </div>
            ))}
      </div>

      {/* ───── How the judgment works ───── */}
      <SectionDivider label="How the Judgment Works" />

      <div className="judgment-flow">
        {HOW_STEPS().map((s) => (
          <div key={s.n} className="step">
            <span className="num">{s.n}</span>
            <h4>{s.title}</h4>
            <p>{s.body}</p>
          </div>
        ))}
      </div>

      {/* ───── Recent Trials + Champion Board ───── */}
      <SectionDivider label="Arena Floor" />

      <div className="cols">
        <div className="stone" style={{ gridColumn: "span 2" }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Recent Trials</h2>
            <Link to="/new" className="btn ghost">▶ New Trial</Link>
          </div>
          {loading ? (
            <div className="empty">Loading…</div>
          ) : trials.length === 0 ? (
            <div className="vault-placeholder">
              <div className="vault-mark"><LaurelMark /></div>
              <div style={{ fontFamily: "var(--serif)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 4 }}>
                Receipts Vault
              </div>
              <div>
                No trials yet. Open the gates — every run produces a JSON +
                Markdown receipt that lands here for audit.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link to="/new" className="btn">▶ Begin first trial</Link>
              </div>
            </div>
          ) : (
            <table className="scroll">
              <thead>
                <tr>
                  <th>Trial</th>
                  <th>Agent</th>
                  <th>Verdict</th>
                  <th>Pass</th>
                  <th>Trust</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {trials.slice(0, 10).map((t) => (
                  <tr key={t.trialId}>
                    <td>
                      <Link to={`/trial/${t.trialId}`}>{t.trialId}</Link>
                    </td>
                    <td>{t.agentId}</td>
                    <td>
                      <VerdictPill verdict={t.verdict} />
                    </td>
                    <td>
                      {t.passCount}/{t.testCount}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <div className="row gap-sm">
                        <span>{Math.round(t.score.trust * 100)}%</span>
                        <ScoreBar value={t.score.trust} />
                      </div>
                    </td>
                    <td className="muted">
                      {new Date(t.startedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="stone">
          <h2 style={{ marginTop: 0 }}>Champion Board</h2>
          <ChampionBoard trials={trials} />
        </div>
      </div>
    </div>
  );
}
