import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Write a fake Aedis CLI script to a fresh temp dir and return:
 *   { scriptPath, aedisBin, dir, transcriptPath }
 *
 * The script:
 *   - Prints `Commands: submit, status, metrics, sessions, workers, health, doctor`
 *     when invoked with no args (so the adapter's commands-list probe finds `submit`).
 *   - Handles `submit <prompt>` by echoing the prompt with a stable marker
 *     and appending the full argv to a transcript file the test can inspect.
 *   - Handles `health` by printing `status: healthy` and exiting 0.
 *
 * Pass `aedisBin` straight to `process.env.AEDIS_BIN` — it is already the
 * "node <scriptPath>" form the adapter expects.
 */
export async function writeFakeAedis(opts?: {
  /** Override the commands list to exclude "submit", to test the missing-verb path. */
  withoutSubmit?: boolean;
  /** Make `health` exit non-zero with a server-down style message. */
  serverDown?: boolean;
}): Promise<{
  dir: string;
  scriptPath: string;
  transcriptPath: string;
  aedisBin: string;
}> {
  const dir = path.join(
    os.tmpdir(),
    `colosseum-fake-aedis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  const scriptPath = path.join(dir, "fake-aedis.js");
  const transcriptPath = path.join(dir, "transcript.log");

  const commands = opts?.withoutSubmit
    ? "status, metrics, sessions, workers, health, doctor"
    : "submit, status, metrics, sessions, workers, health, doctor";

  const healthExit = opts?.serverDown ? 1 : 0;
  const healthBody = opts?.serverDown
    ? "reachable: no — server not running"
    : "status: healthy\nuptime: 0d 0h 1m\nport: 0";

  // Use raw string content so we don't fight quoting.
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);

// Always log the full argv to the transcript so tests can verify wiring.
try { fs.appendFileSync(${JSON.stringify(transcriptPath)}, JSON.stringify(args) + "\\n"); } catch {}

if (args.length === 0) {
  console.log("Usage: aedis <command> [args]");
  console.log("Commands: ${commands}");
  process.exit(0);
}

const verb = args[0];
const rest = args.slice(1);

if (verb === "submit") {
  if (rest.length === 0) {
    console.log("submit <prompt>");
    process.exit(0);
  }
  console.log("aedis-fake-marker: " + rest.join(" | "));
  process.exit(0);
}

if (verb === "health") {
  console.log(${JSON.stringify(healthBody)});
  process.exit(${healthExit});
}

if (verb === "doctor") {
  console.log("reachable: yes  (http://127.0.0.1:0)");
  process.exit(0);
}

// Unknown verb — match the real Aedis CLI's behavior.
console.log("Unknown command: " + verb);
console.log("Commands: ${commands}");
process.exit(1);
`;
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return {
    dir,
    scriptPath,
    transcriptPath,
    aedisBin: `node ${scriptPath}`,
  };
}
