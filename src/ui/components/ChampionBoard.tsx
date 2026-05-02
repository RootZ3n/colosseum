import React from "react";
import { Link } from "react-router-dom";
import type { TrialSummary } from "../api.js";
import { VerdictPill } from "./VerdictPill.js";

export function ChampionBoard({ trials }: { trials: TrialSummary[] }) {
  const top = [...trials]
    .sort((a, b) => b.score.trust - a.score.trust)
    .slice(0, 8);

  if (top.length === 0) {
    return <div className="empty">No champions yet. Open a trial to crown one.</div>;
  }

  return (
    <div>
      <div className="champion" style={{ borderBottomColor: "var(--bronze-1)", color: "var(--marble-vein)" }}>
        <div>RANK</div>
        <div>AGENT · TRIAL</div>
        <div className="right">PASS</div>
        <div className="right">TRUST</div>
        <div className="right">VERDICT</div>
      </div>
      {top.map((t, i) => (
        <div className="champion" key={t.trialId}>
          <div className="rank">{romanNumeral(i + 1)}</div>
          <div className="name">
            <Link to={`/trial/${t.trialId}`}>{t.agentId}</Link>
            <div className="muted" style={{ fontSize: 11 }}>
              {t.trialId} · {new Date(t.startedAt).toLocaleString()}
            </div>
          </div>
          <div className="right">
            {t.passCount}/{t.testCount}
          </div>
          <div className="right">{Math.round(t.score.trust * 100)}%</div>
          <div className="right">
            <VerdictPill verdict={t.verdict} />
          </div>
        </div>
      ))}
    </div>
  );
}

function romanNumeral(n: number): string {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [8, "VIII"], [7, "VII"], [6, "VI"],
    [5, "V"], [4, "IV"], [3, "III"], [2, "II"], [1, "I"],
  ];
  for (const [k, v] of map) if (n >= k) return v + (n > k ? "" : "");
  return String(n);
}
