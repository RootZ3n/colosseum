import React from "react";

export interface TimelineEntry {
  ts: number;
  kind: string;
  text: string;
}

export function ArenaTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="empty">Arena floor is quiet. Open a trial to see live events.</div>
    );
  }
  return (
    <div className="timeline" aria-label="Arena floor timeline">
      {entries.map((e, i) => (
        <div key={i} className={`row kind-${e.kind.replace(/[^a-z0-9_-]+/gi, "-")}`}>
          <div className="ts">{new Date(e.ts).toLocaleTimeString()}</div>
          <div className="body">
            <strong>{e.kind}</strong> {e.text}
          </div>
        </div>
      ))}
    </div>
  );
}
