import React from "react";

export function VerdictPill({ verdict }: { verdict: string }) {
  const v = (verdict ?? "").toLowerCase();
  return <span className={`pill ${v}`}>{v}</span>;
}
