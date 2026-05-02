import { promises as fs } from "node:fs";
import path from "node:path";
import type { Receipt } from "./receipt.js";
import { renderReceipt } from "./receipt.js";

/**
 * Filesystem-backed receipt store.
 *
 * Layout:
 *   <stateRoot>/receipts/<trialId>/<safeTestId>.json
 *   <stateRoot>/receipts/<trialId>/<safeTestId>.md
 */
export class ReceiptStore {
  constructor(private readonly stateRoot: string) {}

  async save(r: Receipt): Promise<{ jsonPath: string; mdPath: string }> {
    const dir = path.join(this.stateRoot, "receipts", r.trialId);
    await fs.mkdir(dir, { recursive: true });
    const safe = r.testId.replace(/[^a-z0-9_.-]/gi, "_");
    const jsonPath = path.join(dir, `${safe}.json`);
    const mdPath = path.join(dir, `${safe}.md`);
    await fs.writeFile(jsonPath, JSON.stringify(r, null, 2));
    await fs.writeFile(mdPath, renderReceipt(r));
    return { jsonPath, mdPath };
  }

  async list(trialId: string): Promise<Receipt[]> {
    const dir = path.join(this.stateRoot, "receipts", trialId);
    const entries = await fs.readdir(dir).catch(() => []);
    const out: Receipt[] = [];
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      const txt = await fs.readFile(path.join(dir, e), "utf8").catch(() => "");
      if (!txt) continue;
      try {
        out.push(JSON.parse(txt));
      } catch {
        // skip bad entries
      }
    }
    return out;
  }

  async get(trialId: string, testId: string): Promise<Receipt | null> {
    const safe = testId.replace(/[^a-z0-9_.-]/gi, "_");
    const file = path.join(this.stateRoot, "receipts", trialId, `${safe}.json`);
    const txt = await fs.readFile(file, "utf8").catch(() => "");
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}
