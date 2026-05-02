import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Receipt } from "../api.js";
import { VerdictPill } from "../components/VerdictPill.js";

export function ReceiptDetail() {
  const { trialId, testId } = useParams();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trialId || !testId) return;
    api
      .receipt(trialId, decodeURIComponent(testId))
      .then(setReceipt)
      .finally(() => setLoading(false));
  }, [trialId, testId]);

  if (loading) return <div className="page">Loading…</div>;
  if (!receipt) return <div className="page">No such receipt.</div>;

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Receipt</h1>
          <div className="muted mono">{receipt.receiptId}</div>
        </div>
        <Link to={`/trial/${receipt.trialId}`} className="btn ghost">
          ← Back to trial
        </Link>
      </div>

      <div className="marble">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{receipt.testId}</h2>
          <VerdictPill verdict={receipt.verdict} />
        </div>
        <div style={{ marginTop: 6, color: "var(--ink-soft)" }}>
          {receipt.expectedBehavior}
        </div>

        <div className="cols" style={{ marginTop: 18 }}>
          <div>
            <div className="muted">Model</div>
            <div>{receipt.modelInfo.model}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {receipt.modelInfo.provider} · {receipt.modelInfo.location}
            </div>
          </div>
          <div>
            <div className="muted">Cost</div>
            {receipt.costInfo.reported ? (
              <>
                <div>${(receipt.costInfo.estimatedCostUsd ?? 0).toFixed(4)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  prompt={receipt.costInfo.promptTokens ?? "?"} output=
                  {receipt.costInfo.outputTokens ?? "?"}
                </div>
              </>
            ) : (
              <span className="muted">not reported ({receipt.costInfo.note})</span>
            )}
          </div>
          <div>
            <div className="muted">Velum</div>
            <div>{receipt.velum.decision}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {receipt.velum.findings.length} finding(s)
            </div>
          </div>
          <div>
            <div className="muted">Duration</div>
            <div>{receipt.durationMs}ms</div>
          </div>
        </div>

        <div className="divider" style={{ background: "rgba(0,0,0,0.08)" }} />

        <h3>Reasons</h3>
        <ul style={{ marginTop: 0 }}>
          {receipt.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>

        {receipt.velum.findings.length > 0 && (
          <>
            <h3>Velum findings</h3>
            <ul>
              {receipt.velum.findings.map((f, i) => (
                <li key={i}>
                  <code>{f.rule}</code> — {f.severity} → {f.decision}: {f.reason}
                </li>
              ))}
            </ul>
          </>
        )}

        {receipt.artifacts.length > 0 && (
          <>
            <h3>Artifacts</h3>
            <ul>
              {receipt.artifacts.slice(0, 30).map((a) => (
                <li key={a.path}>
                  <code>{a.path}</code>{" "}
                  <span className="muted">({a.bytes} bytes)</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div style={{ height: 22 }} />

      <div className="stone">
        <h2 style={{ marginTop: 0 }}>Prompt</h2>
        <pre className="receipt">{receipt.prompt}</pre>
      </div>

      <div style={{ height: 18 }} />

      <div className="cols">
        <div className="stone">
          <h2 style={{ marginTop: 0 }}>stdout (tail, redacted)</h2>
          <pre className="receipt">{receipt.stdoutSummary || "(empty)"}</pre>
        </div>
        <div className="stone">
          <h2 style={{ marginTop: 0 }}>stderr (tail, redacted)</h2>
          <pre className="receipt">{receipt.stderrSummary || "(empty)"}</pre>
        </div>
      </div>

      <div style={{ height: 18 }} />

      <div className="stone">
        <h2 style={{ marginTop: 0 }}>Event stream</h2>
        <div className="timeline">
          {receipt.events.map((e, i) => (
            <div key={i} className={`row kind-${e.kind}`}>
              <div className="ts">{new Date(e.ts).toLocaleTimeString()}</div>
              <div className="body">
                <strong>{e.kind}</strong> {e.text ?? ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
