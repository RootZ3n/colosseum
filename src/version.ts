import { spawnSync } from "node:child_process";

/** Single source of truth for Colosseum's version. */
export const COLOSSEUM_VERSION = "0.1.0";

/**
 * Resolve the git commit of the *Colosseum repo itself* (not the workspace
 * under test). Returns "unknown" if not in a git checkout — never lies.
 */
export function getGitCommit(cwd: string = process.cwd()): string {
  try {
    const r = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status === 0) {
      const out = r.stdout.trim();
      if (out.length > 0) return out;
    }
  } catch {
    // fall through
  }
  return "unknown";
}
