import React, { useEffect, useState } from "react";
import { api, type AgentSummary } from "../api.js";

export function Agents() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  useEffect(() => {
    api.agents().then(setAgents);
  }, []);
  return (
    <div className="page">
      <h1 className="page-title">Agents</h1>
      <div className="page-sub">Combatants registered to the arena.</div>
      <div className="cols">
        {agents.map((a) => (
          <div className="marble" key={a.id}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{a.name}</h2>
              <span className="pill pill-marble">{a.id}</span>
            </div>
            <p style={{ color: "var(--ink-soft)" }}>{a.description}</p>
            <div className="row wrap gap-sm">
              {Object.entries(a.capabilities).map(([k, v]) => (
                <span
                  key={k}
                  className="pill"
                  style={{
                    color: v ? "var(--laurel)" : "var(--ink-soft)",
                    background: v ? "rgba(47,122,85,0.10)" : "rgba(0,0,0,0.04)",
                    borderColor: v ? "var(--laurel)" : "var(--bracket)",
                  }}
                >
                  {k}: {v ? "yes" : "no"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
