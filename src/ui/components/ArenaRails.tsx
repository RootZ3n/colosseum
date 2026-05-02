import React from "react";

/** Decorative left/right column rails. CSS-only, hidden on narrow widths. */
export function ArenaRails() {
  return (
    <>
      <div className="arena-rail left" aria-hidden="true" />
      <div className="arena-rail right" aria-hidden="true" />
    </>
  );
}

/** Bronze-rule section divider with a centered gold label. */
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="section-divider" aria-hidden="false">
      <span className="label">{label}</span>
    </div>
  );
}
