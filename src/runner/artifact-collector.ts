import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentArtifact } from "../types.js";

/**
 * Walks a workspace and produces an artifact list for the receipt.
 * Intentionally bounded — we cap reads at 64KB inline preview per file.
 */

const PREVIEW_BYTES = 256;
const MAX_FILES = 500;

export async function collectArtifacts(workspace: string): Promise<AgentArtifact[]> {
  const out: AgentArtifact[] = [];
  await walk(workspace, workspace, out);
  return out.slice(0, MAX_FILES);
}

async function walk(dir: string, root: string, out: AgentArtifact[]) {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    // The runner places a per-test git snapshot at workspace/.git so it can
    // diff agent-induced changes for the receipt. That directory is harness
    // infrastructure — never agent output — so it is excluded from artifacts.
    if (e === ".git") continue;
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      await walk(full, root, out);
    } else {
      const rel = path.relative(root, full);
      let preview: string | undefined;
      if (stat.size > 0 && stat.size < 16 * 1024 * 1024) {
        const fh = await fs.open(full, "r").catch(() => null);
        if (fh) {
          const buf = Buffer.alloc(Math.min(PREVIEW_BYTES, stat.size));
          await fh.read(buf, 0, buf.length, 0);
          await fh.close();
          preview = buf.toString("utf8").replace(/\0/g, "");
        }
      }
      out.push({ path: rel, bytes: stat.size, preview });
    }
  }
}
