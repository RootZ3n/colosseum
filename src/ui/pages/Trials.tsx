import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TrialSummary } from "../api.js";
import { VerdictPill } from "../components/VerdictPill.js";
import { ScoreBar } from "../components/ScoreBar.js";

export function Trials() {
  const [trials, setTrials] = useState<TrialSummary[]>([]);
  useEffect(() => {
    api.trials().then(setTrials);
  }, []);
  return (
    <div className="page">
      <h1 className="page-title">Trials</h1>
      <div className="page-sub">Every fight, every receipt.</div>
      <div className="stone">
        {trials.length === 0 ? (
          <div className="empty">No trials yet.</div>
        ) : (
          <table className="scroll">
            <thead>
              <tr>
                <th>Trial</th>
                <th>Agent</th>
                <th>Verdict</th>
                <th>Pass</th>
                <th>Trust</th>
                <th>Velum</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t) => (
                <tr key={t.trialId}>
                  <td>
                    <Link to={`/trial/${t.trialId}`}>{t.trialId}</Link>
                  </td>
                  <td>{t.agentId}</td>
                  <td>
                    <VerdictPill verdict={t.verdict} />
                  </td>
                  <td>{t.passCount}/{t.testCount}</td>
                  <td>
                    <div className="row gap-sm">
                      <span>{Math.round(t.score.trust * 100)}%</span>
                      <ScoreBar value={t.score.trust} />
                    </div>
                  </td>
                  <td>
                    <span className="pill" style={{ color: "var(--marble-vein)" }}>
                      {t.velumDecision}
                    </span>
                  </td>
                  <td className="muted">{new Date(t.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
