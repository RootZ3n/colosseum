import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Verdict } from "../types.js";

/**
 * Per-trial workspace lifecycle.
 *
 * Every test runs inside a freshly-created throwaway directory. The directory
 * is created under colosseum-state/fixtures/<trial>/<test> when a stateRoot
 * is provided, otherwise under the OS temp directory.
 *
 * Important: tested repos must NOT be dirtied. The fixture is *always* a fresh
 * copy or a fresh empty directory — the agent never operates on a real repo.
 */

/**
 * Cleanup policy for per-test workspaces:
 *   "always"  — remove every workspace at end-of-trial.
 *   "success" — remove only PASS/WARN; preserve FAIL/ERROR for evidence (DEFAULT).
 *   "never"   — preserve all workspaces.
 *
 * Receipts and trial summaries are NEVER deleted by cleanup — only fixtures.
 */
export type CleanupPolicy = "always" | "success" | "never";

export const DEFAULT_CLEANUP_POLICY: CleanupPolicy = "success";

const PRESERVE_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>(["fail", "error"]);

export class FixtureManager {
  constructor(private readonly stateRoot: string | null) {}

  async createWorkspace(trialId: string, testId: string): Promise<string> {
    const safeTest = testId.replace(/[^a-z0-9_.-]/gi, "_");
    const base = this.stateRoot
      ? path.join(this.stateRoot, "fixtures", trialId)
      : path.join(os.tmpdir(), "colosseum", trialId);
    const dir = path.join(base, `${safeTest}-${nanoid(6)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async copyFixtureInto(fixtureDir: string, into: string): Promise<void> {
    await this.recursiveCopy(fixtureDir, into);
  }

  /**
   * @deprecated kept for backward compatibility — prefer applyCleanupPolicy().
   * Removes the entire trial fixture directory when stateRoot is unset.
   */
  async cleanup(trialId: string): Promise<void> {
    if (!this.stateRoot) {
      const base = path.join(os.tmpdir(), "colosseum", trialId);
      await fs.rm(base, { recursive: true, force: true });
    }
  }

  /**
   * Apply the configured cleanup policy. Returns a list of `{ testId, removed }`
   * records so the runner can put them on the trial summary for transparency.
   *
   * Receipts and trial summaries are never touched.
   */
  async applyCleanupPolicy(
    trialId: string,
    verdictByTestId: ReadonlyMap<string, Verdict>,
    policy: CleanupPolicy,
  ): Promise<Array<{ testId: string; removed: boolean; reason: string }>> {
    if (policy === "never") {
      return [...verdictByTestId.keys()].map((testId) => ({
        testId,
        removed: false,
        reason: "policy=never",
      }));
    }
    const base = this.stateRoot
      ? path.join(this.stateRoot, "fixtures", trialId)
      : path.join(os.tmpdir(), "colosseum", trialId);

    let entries: string[] = [];
    try {
      entries = await fs.readdir(base);
    } catch {
      return [];
    }

    const out: Array<{ testId: string; removed: boolean; reason: string }> = [];
    for (const dirName of entries) {
      // Workspace dir name is "<safeTestId>-<rand>"; recover the testId
      // by stripping the trailing nanoid (6 chars after the last "-").
      const testId = dirName.replace(/-[A-Za-z0-9_-]{6}$/, "");
      const verdict = verdictByTestId.get(testId);
      const shouldPreserve =
        policy === "success" && verdict !== undefined && PRESERVE_VERDICTS.has(verdict);
      if (shouldPreserve) {
        out.push({
          testId,
          removed: false,
          reason: `preserve ${verdict} fixture for evidence`,
        });
        continue;
      }
      const target = path.join(base, dirName);
      try {
        await fs.rm(target, { recursive: true, force: true });
        out.push({
          testId,
          removed: true,
          reason:
            policy === "always"
              ? "policy=always"
              : `cleanup ${verdict ?? "unknown"} per policy=success`,
        });
      } catch (err) {
        out.push({
          testId,
          removed: false,
          reason: `cleanup failed: ${(err as Error).message}`,
        });
      }
    }
    return out;
  }

  private async recursiveCopy(src: string, dst: string) {
    const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
    await fs.mkdir(dst, { recursive: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) await this.recursiveCopy(s, d);
      else await fs.copyFile(s, d);
    }
  }
}
