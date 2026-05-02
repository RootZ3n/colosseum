import React from "react";

export function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="score-bar" aria-valuenow={Math.round(pct)} role="progressbar">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
