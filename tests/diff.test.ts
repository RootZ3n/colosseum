import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { computeDiff, snapshotWorkspace } from "@colosseum/runner/diff.js";

async function tmpdir(): Promise<string> {
  const d = path.join(
    os.tmpdir(),
    `colosseum-diff-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe("diff helper", () => {
  it("returns empty diff when nothing was changed after the snapshot", async () => {
    const ws = await tmpdir();
    await fs.writeFile(path.join(ws, "seed.txt"), "ave");
    expect(snapshotWorkspace(ws).ok).toBe(true);

    const d = computeDiff(ws);
    expect(d.status).toBe("unchanged");
    expect(d.text).toBe("");
    expect(d.filesChanged).toEqual([]);
    expect(d.shortSummary).toBe("no changes");
    expect(d.truncated).toBe(false);
  });

  it("captures a new file as an added file in the diff", async () => {
    const ws = await tmpdir();
    await fs.writeFile(path.join(ws, "seed.txt"), "ave");
    snapshotWorkspace(ws);
    await fs.writeFile(path.join(ws, "new.txt"), "imperator");

    const d = computeDiff(ws);
    expect(d.status).toBe("changed");
    expect(d.filesChanged).toContain("new.txt");
    expect(d.text).toMatch(/\+imperator/);
    expect(d.shortSummary).toMatch(/insertion|file/);
  });

  it("captures a modified file's added/removed lines", async () => {
    const ws = await tmpdir();
    await fs.writeFile(path.join(ws, "greet.ts"), "export const greet = 'hello';\n");
    snapshotWorkspace(ws);
    await fs.writeFile(path.join(ws, "greet.ts"), "export const greet = 'salve';\n");

    const d = computeDiff(ws);
    expect(d.status).toBe("changed");
    expect(d.filesChanged).toEqual(["greet.ts"]);
    expect(d.text).toMatch(/-export const greet = 'hello'/);
    expect(d.text).toMatch(/\+export const greet = 'salve'/);
  });

  it("truncates oversized diffs and marks truncated:true", async () => {
    const ws = await tmpdir();
    await fs.writeFile(path.join(ws, "f.txt"), "");
    snapshotWorkspace(ws);
    await fs.writeFile(path.join(ws, "f.txt"), "x".repeat(20_000));

    const d = computeDiff(ws, 2000);
    expect(d.status).toBe("changed");
    expect(d.truncated).toBe(true);
    expect(d.text.length).toBeLessThan(20_000);
    expect(d.text).toMatch(/truncated/);
  });

  it("marks the diff unavailable when the workspace was never snapshotted", async () => {
    const ws = await tmpdir();
    await fs.writeFile(path.join(ws, "stray.txt"), "no snapshot here");
    const d = computeDiff(ws);
    expect(d.status).toBe("unavailable");
    expect(d.text).toBe("");
    expect(d.shortSummary).toBe("diff unavailable");
    expect(d.reason).toMatch(/not snapshotted|git diff is unavailable/i);
  });
});
