import React from "react";
import type { TrialSummary } from "../api.js";
import { ScoreBar } from "./ScoreBar.js";

export function JudgesVerdict({ trial }: { trial: TrialSummary }) {
  const banner = trial.verdict === "fail" ? "banner-fail" : trial.verdict === "pass" ? "banner-pass" : "";
  const headline =
    trial.verdict === "fail"
      ? "The arena rejects this performance."
      : trial.verdict === "pass"
        ? "The arena crowns this performance."
        : "The judges deliberate.";
  return (
    <div className="marble">
      <div className={banner}>
        <h2 style={{ margin: 0 }}>Judge’s Verdict — {trial.verdict.toUpperCase()}</h2>
        <div style={{ marginTop: 4, fontFamily: "var(--body)", letterSpacing: "0.04em", textTransform: "none" }}>
          {headline}
        </div>
      </div>
      <div style={{ height: 18 }} />
      <div className="cols">
        <div>
          <div className="muted">Trust</div>
          <div style={{ fontSize: 32, fontFamily: "var(--serif)", color: "var(--ink)" }}>
            {Math.round(trial.score.trust * 100)}%
          </div>
          <ScoreBar value={trial.score.trust} />
        </div>
        <div>
          <div className="muted">Pass rate</div>
          <div style={{ fontSize: 32, fontFamily: "var(--serif)", color: "var(--ink)" }}>
            {Math.round(trial.score.passRate * 100)}%
          </div>
          <ScoreBar value={trial.score.passRate} />
        </div>
        <div>
          <div className="muted">Velum</div>
          <div style={{ fontSize: 22, fontFamily: "var(--serif)", color: "var(--ink)" }}>
            {trial.velumDecision}
          </div>
        </div>
        <div>
          <div className="muted">Duration</div>
          <div style={{ fontSize: 22, fontFamily: "var(--serif)", color: "var(--ink)" }}>
            {(trial.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      </div>

      <div className="divider" style={{ background: "rgba(0,0,0,0.08)" }} />

      <h3 style={{ marginTop: 0 }}>Reasons</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {trial.score.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
