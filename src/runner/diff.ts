import { spawnSync } from "node:child_process";

/**
 * Per-test workspace diffing.
 *
 *   1. Right after `setup()` seeds fixture files, the runner takes a snapshot
 *      with `snapshotWorkspace()` — git init + commit of the seeded state.
 *   2. After the agent runs, `computeDiff()` stages all changes and returns
 *      `git diff --cached` as a unified diff string.
 *
 * This gives us a real, reviewable diff for the receipt's `repoDiffSummary`
 * without depending on git in the host repo (the workspace has its own .git).
 *
 * Failures are tolerated: if git isn't available or the workspace is unusual,
 * we return an empty string rather than crash the trial. The receipt notes
 * "diff unavailable" via the renderer.
 */

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "colosseum",
  GIT_AUTHOR_EMAIL: "arena@colosseum.local",
  GIT_COMMITTER_NAME: "colosseum",
  GIT_COMMITTER_EMAIL: "arena@colosseum.local",
  // Avoid inheriting the host's commit.gpgsign or hooks.
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args: string[], cwd: string) {
  return spawnSync("git", args, {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function snapshotWorkspace(workspace: string): { ok: boolean; reason?: string } {
  const init = git(["init", "-q", "-b", "arena"], workspace);
  if (init.status !== 0) {
    return { ok: false, reason: init.stderr?.trim() || "git init failed" };
  }
  git(["add", "-A"], workspace);
  const commit = git(
    ["commit", "-q", "--allow-empty", "-m", "colosseum: pre-agent snapshot"],
    workspace,
  );
  if (commit.status !== 0) {
    return { ok: false, reason: commit.stderr?.trim() || "git commit failed" };
  }
  return { ok: true };
}

export interface DiffResult {
  /** Whether diffing succeeded, found no changes, or could not verify changes. */
  status: "changed" | "unchanged" | "unavailable";
  /** Unified diff text. Empty when no changes. */
  text: string;
  /** Files changed in the workspace since the snapshot. */
  filesChanged: string[];
  /** Brief one-line summary, e.g. "3 file(s) changed, +12 -4". */
  shortSummary: string;
  /** True if the diff was truncated for size. */
  truncated: boolean;
  /** Human-readable reason when status === "unavailable". */
  reason?: string;
}

export function computeDiff(workspace: string, maxBytes = 4000): DiffResult {
  const unchanged: DiffResult = {
    status: "unchanged",
    text: "",
    filesChanged: [],
    shortSummary: "no changes",
    truncated: false,
  };
  const unavailable = (reason: string): DiffResult => ({
    status: "unavailable",
    text: "",
    filesChanged: [],
    shortSummary: "diff unavailable",
    truncated: false,
    reason,
  });

  // If there's no .git, the snapshot step never happened — do not call that
  // "no changes"; the receipt must distinguish unknown from unchanged.
  const hasGit = git(["rev-parse", "--is-inside-work-tree"], workspace);
  if (hasGit.status !== 0) {
    return unavailable(
      `workspace was not snapshotted; git diff is unavailable${
        hasGit.stderr?.trim() ? ` (${hasGit.stderr.trim().split("\n")[0]})` : ""
      }`,
    );
  }

  const add = git(["add", "-A"], workspace);
  if (add.status !== 0) {
    return unavailable(add.stderr?.trim() || "git add failed while computing diff");
  }

  const status = git(["diff", "--cached", "--name-only"], workspace);
  if (status.status !== 0) {
    return unavailable(status.stderr?.trim() || "git diff --name-only failed");
  }
  const filesChanged = (status.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (filesChanged.length === 0) return unchanged;

  const stat = git(["diff", "--cached", "--shortstat"], workspace);
  const shortSummary = (stat.stdout ?? "").trim() || `${filesChanged.length} file(s) changed`;

  const diff = git(["diff", "--cached", "--no-color", "--unified=2"], workspace);
  if (diff.status !== 0) {
    return unavailable(diff.stderr?.trim() || "git diff failed");
  }
  const text = diff.stdout ?? "";
  if (text.length <= maxBytes) {
    return { status: "changed", text, filesChanged, shortSummary, truncated: false };
  }
  const truncatedText =
    text.slice(0, maxBytes) +
    `\n…[truncated, ${text.length - maxBytes} more bytes]`;
  return { status: "changed", text: truncatedText, filesChanged, shortSummary, truncated: true };
}
