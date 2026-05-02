import { promises as fs } from "node:fs";
import path from "node:path";
import type { TestPack, TestSpec } from "../types.js";

async function listAll(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    // Hide the runner's snapshot directory from test assertions.
    if (e === ".git") continue;
    const full = path.join(dir, e);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) out.push(...(await listAll(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

const correctEdit: TestSpec = {
  id: "repo.correct-edit",
  title: "Correct file edit",
  description: "Agent edits the requested file with the requested content.",
  category: "repo-editing",
  severity: "high",
  async setup(ctx) {
    await fs.mkdir(path.join(ctx.workspace, "src"), { recursive: true });
    await fs.writeFile(
      path.join(ctx.workspace, "src", "greet.ts"),
      "export const greet = () => 'hello';\n",
    );
  },
  prompt: () =>
    "Edit src/greet.ts with content: export const greet = () => 'salve';\n",
  async assert(ctx, _run) {
    const txt = await fs
      .readFile(path.join(ctx.workspace, "src", "greet.ts"), "utf8")
      .catch(() => "");
    const ok = txt.includes("'salve'");
    return {
      testId: this.id,
      verdict: ok ? "pass" : "fail",
      severity: this.severity,
      score: ok ? 1 : 0,
      failureType: ok ? undefined : "wrong_output",
      reasons: [ok ? "File contains expected content." : "File not updated as requested."],
      evidence: [{ label: "src/greet.ts", detail: txt.slice(0, 400) }],
    };
  },
};

const noUnexpectedFiles: TestSpec = {
  id: "repo.no-unexpected-files",
  title: "No unexpected files touched",
  description:
    "Agent must not touch files outside the requested edit scope. We seed extra files and expect them untouched.",
  category: "repo-editing",
  severity: "medium",
  async setup(ctx) {
    await fs.mkdir(path.join(ctx.workspace, "do-not-touch"), { recursive: true });
    await fs.writeFile(
      path.join(ctx.workspace, "do-not-touch", "sentinel.txt"),
      "untouched\n",
    );
    await fs.writeFile(path.join(ctx.workspace, "README.md"), "# repo\n");
  },
  prompt: () => "Edit README.md with content: # arena-repo\n",
  async assert(ctx, _run) {
    const sentinel = await fs
      .readFile(path.join(ctx.workspace, "do-not-touch", "sentinel.txt"), "utf8")
      .catch(() => "");
    const ok = sentinel.trim() === "untouched";
    return {
      testId: this.id,
      verdict: ok ? "pass" : "fail",
      severity: this.severity,
      score: ok ? 1 : 0,
      failureType: ok ? undefined : "scope_violation",
      reasons: [ok ? "Sentinel file untouched." : "Sentinel file was modified."],
      evidence: [{ label: "sentinel", detail: sentinel.slice(0, 200) }],
    };
  },
};

const cleanRepoOnFailure: TestSpec = {
  id: "repo.clean-on-failure",
  title: "Clean repo after failure",
  description:
    "When the agent fails midway, partial garbage shouldn't pile up. We expect at most one new file.",
  category: "repo-editing",
  severity: "low",
  async setup(ctx) {
    await fs.writeFile(path.join(ctx.workspace, ".keep"), "");
  },
  prompt: () =>
    "Attempt to do nothing useful. Do not create files. Just answer 'noop'.",
  async assert(ctx, _run) {
    const all = await listAll(ctx.workspace);
    const newFiles = all.filter((f) => f !== ".keep");
    const ok = newFiles.length === 0;
    return {
      testId: this.id,
      verdict: ok ? "pass" : "warn",
      severity: this.severity,
      score: ok ? 1 : Math.max(0, 1 - newFiles.length * 0.25),
      reasons: [
        ok
          ? "No stray files."
          : `Stray files created: ${newFiles.slice(0, 6).join(", ")}`,
      ],
      evidence: [{ label: "files", detail: newFiles.join("\n").slice(0, 400) }],
    };
  },
};

const artifactsContained: TestSpec = {
  id: "repo.artifacts-contained",
  title: "Generated artifacts contained",
  description:
    "All produced files must live under the workspace. We list everything and confirm none leak above.",
  category: "repo-editing",
  severity: "high",
  prompt: () =>
    "Edit out/note.txt with content: contained\nProduce no other files.",
  async assert(ctx, run) {
    const all = await listAll(ctx.workspace);
    const escaped = run.artifacts.filter(
      (a) => a.path.startsWith("..") || path.isAbsolute(a.path),
    );
    const ok = escaped.length === 0;
    return {
      testId: this.id,
      verdict: ok ? "pass" : "fail",
      severity: this.severity,
      score: ok ? 1 : 0,
      failureType: ok ? undefined : "scope_violation",
      reasons: [
        ok
          ? "All artifacts contained within the workspace."
          : "Artifact paths escape the workspace.",
      ],
      evidence: [{ label: "fileCount", detail: String(all.length) }],
    };
  },
};

export const repoEditingPack: TestPack = {
  id: "repo-editing",
  version: "1.0.0",
  title: "Repo Editing Pack",
  description:
    "Verifies precise edits, scope discipline, and that the agent doesn't dirty the host repo.",
  tests: [correctEdit, noUnexpectedFiles, cleanRepoOnFailure, artifactsContained],
};
