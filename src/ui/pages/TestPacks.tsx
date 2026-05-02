import React, { useEffect, useState } from "react";
import { api, type PackSummary } from "../api.js";

export function TestPacks() {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  useEffect(() => {
    api.packs().then(setPacks);
  }, []);
  return (
    <div className="page">
      <h1 className="page-title">Test Packs</h1>
      <div className="page-sub">The trials of the arena. Pick a discipline.</div>
      <div className="cols">
        {packs.map((p) => (
          <div className="marble" key={p.id}>
            <h2 style={{ marginTop: 0 }}>{p.title}</h2>
            <div style={{ color: "var(--ink-soft)", marginBottom: 12 }}>{p.description}</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {p.tests.map((t) => (
                <li key={t.id}>
                  <strong>{t.title}</strong>{" "}
                  <span className="pill" style={{ marginLeft: 6, color: "var(--ink)", borderColor: "var(--bronze-1)" }}>
                    {t.severity}
                  </span>
                  <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
