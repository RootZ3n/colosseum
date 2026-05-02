import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Receipt, type TrialSummary } from "../api.js";
import { VerdictPill } from "../components/VerdictPill.js";
import { ScoreBar } from "../components/ScoreBar.js";
import { ArenaRails, SectionDivider } from "../components/ArenaRails.js";

export function TrialResults() {
  const { id } = useParams();
  const [trial, setTrial] = useState<TrialSummary | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.trial(id), api.receipts(id)])
      .then(([t, rs]) => {
        setTrial(t);
        setReceipts(rs);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page">Loading…</div>;
  if (!trial) return <div className="page">No such trial.</div>;

  const headlineMap: Record<string, { headline: string; sub: string }> = {
    pass: {
      headline: "Crowned",
      sub: "The arena recognizes this performance.",
    },
    fail: {
      headline: "Rejected",
      sub: "The arena turns its back. Read the receipts — every reason is recorded.",
    },
    warn: {
      headline: "Marked",
      sub: "Not blocked, but the judges have flagged concerns. See the receipts.",
    },
    error: {
      headline: "Interrupted",
      sub: "An error stopped the trial. The receipts hold what was captured.",
    },
    skipped: { headline: "Empty", sub: "No tests ran." },
  };
  const head = headlineMap[trial.verdict] ?? headlineMap.warn;

  return (
    <div className="page">
      <ArenaRails />

      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div
            className="muted"
            style={{
              fontFamily: "var(--serif)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            Trial Results
          </div>
          <div className="muted mono">{trial.trialId}</div>
        </div>
        <Link to="/new" className="btn ghost">▶ New Trial</Link>
      </div>

      {/* Verdict marquee — the dominant judgment surface */}
      <section className={`verdict-marquee ${trial.verdict}`}>
        <div>
          <div
            className="muted"
            style={{
              fontFamily: "var(--serif)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            Judge’s Verdict
          </div>
          <div className="headline">
            {head.headline} · {trial.verdict.toUpperCase()}
          </div>
          <div className="sub">{head.sub}</div>
          <div style={{ marginTop: 14 }}>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--marble-1)" }}>
              {trial.score.reasons.slice(0, 3).map((r, i) => (
                <li key={i} style={{ fontSize: 13.5 }}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="stat-rail">
          <div className="stat">
            <div className="label">Trust</div>
            <div className="value">{Math.round(trial.score.trust * 100)}%</div>
            <div style={{ width: 110, marginTop: 6 }}>
              <ScoreBar value={trial.score.trust} />
            </div>
          </div>
          <div className="stat">
            <div className="label">Pass</div>
            <div className="value">
              {trial.passCount}/{trial.testCount}
            </div>
          </div>
          <div className="stat">
            <div className="label">Velum</div>
            <div className="value" style={{ fontSize: 18 }}>
              {trial.velumDecision}
            </div>
          </div>
        </div>
      </section>

      <SectionDivider label="Test-by-test verdicts" />

      <div className="cols">
        <div className="vault" style={{ gridColumn: "span 2" }}>
          <div className="vault-header">
            <h3>Evidence Vault</h3>
            <span className="count">
              {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="vault-list">
            {receipts.map((r) => (
              <div key={r.testId} className={`vault-row ${r.verdict}`}>
                <div className="verdict-cell">
                  <VerdictPill verdict={r.verdict} />
                  {r.verdict === "fail" && r.failureType ? (
                    <span className="fail-type">{r.failureType}</span>
                  ) : null}
                </div>
                <div className="test-cell">
                  <div className="testid">{r.testId}</div>
                  <div className="desc">{r.expectedBehavior}</div>
                  {r.reasons[0] ? (
                    <div
                      className="muted"
                      style={{ fontSize: 12, marginTop: 4 }}
                    >
                      {r.reasons[0]}
                    </div>
                  ) : null}
                </div>
                <div className="meta">
                  <div>
                    {r.modelInfo.model} · {r.modelInfo.location}
                  </div>
                  <div>
                    {r.costInfo.reported
                      ? `$${(r.costInfo.estimatedCostUsd ?? 0).toFixed(4)} · ${r.costInfo.totalTokens ?? "?"} tok`
                      : "cost not reported"}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Link
                      to={`/receipt/${trial.trialId}/${encodeURIComponent(r.testId)}`}
                    >
                      open receipt →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stone">
          <h2 style={{ marginTop: 0 }}>Score breakdown</h2>
          {trial.score.perCategory
            .filter((c) => c.n > 0)
            .map((c) => (
              <div key={c.category} style={{ marginBottom: 14 }}>
                <div className="row between">
                  <strong style={{ textTransform: "capitalize" }}>{c.category}</strong>
                  <span>{Math.round(c.value * 100)}%</span>
                </div>
                <ScoreBar value={c.value} />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {c.reasons[0]}
                </div>
              </div>
            ))}
          <div className="divider" />
          <div className="row between">
            <strong>Cost efficiency</strong>
            <span>{Math.round(trial.score.costEfficiency.value * 100)}%</span>
          </div>
          <ScoreBar value={trial.score.costEfficiency.value} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {trial.score.costEfficiency.reasons[0]}
          </div>
        </div>
      </div>

      {/* Arena Timeline section — flatten all receipts' events newest-last */}
      <SectionDivider label="Arena Timeline" />

      <div className="stone">
        <div
          className="muted"
          style={{ fontSize: 12, marginBottom: 8 }}
        >
          Aggregated agent events from every test in this trial. Each receipt
          carries its own narrow timeline; this is the wide-angle view.
        </div>
        <div className="timeline">
          {receipts
            .flatMap((r) =>
              (r.events ?? []).map((e) => ({
                ts: e.ts,
                kind: e.kind,
                text: `${r.testId}: ${e.text ?? ""}`.slice(0, 240),
              })),
            )
            .sort((a, b) => a.ts - b.ts)
            .slice(-200)
            .map((e, i) => (
              <div key={i} className={`row kind-${e.kind}`}>
                <div className="ts">
                  {new Date(e.ts).toLocaleTimeString()}
                </div>
                <div className="body">
                  <strong>{e.kind}</strong> {e.text}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
