import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("UI live Arena view", () => {
  it("renders LIVE/BUFFERED state and the non-streaming adapter message", async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/ui/pages/NewTrial.tsx"),
      "utf8",
    );
    const css = await fs.readFile(
      path.resolve(process.cwd(), "src/ui/styles.css"),
      "utf8",
    );
    expect(src).toContain("LIVE");
    expect(src).toContain("BUFFERED");
    expect(src).toContain("This adapter does not provide live step events");
    expect(src).toContain("pending scoring");
    expect(css).toContain(".live-badge.live");
    expect(css).toContain(".critical-banner");
  });
});
