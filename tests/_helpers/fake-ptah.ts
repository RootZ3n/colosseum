import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Write a fake Ptah CLI script to a fresh temp dir and return:
 *   { dir, scriptPath, transcriptPath, ptahBin }
 *
 * Ptah currently ships as a service, not a CLI. This fixture lets tests
 * exercise the adapter's submit-protocol wiring against a real subprocess
 * that mimics the SHAPE we expect a future Ptah CLI (or wrapper script)
 * to expose:
 *
 *   - No-args invocation prints a `Commands: submit, status, health, ...`
 *     usage line, with `submit` either present or absent depending on the
 *     `withoutSubmit` option.
 *   - `submit <prompt>` echoes the prompt with a stable marker and appends
 *     the full argv to a transcript the test can inspect.
 *   - `health` prints `status: healthy` (or simulates a server-down failure
 *     when `serverDown` is set).
 */
export async function writeFakePtah(opts?: {
  /** Omit `submit` from the commands list to test the missing-verb path. */
  withoutSubmit?: boolean;
  /** Make `health` exit non-zero with a server-down style message. */
  serverDown?: boolean;
}): Promise<{
  dir: string;
  scriptPath: string;
  transcriptPath: string;
  ptahBin: string;
}> {
  const dir = path.join(
    os.tmpdir(),
    `colosseum-fake-ptah-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  const scriptPath = path.join(dir, "fake-ptah.js");
  const transcriptPath = path.join(dir, "transcript.log");

  const commands = opts?.withoutSubmit
    ? "status, health, sessions, queue"
    : "submit, status, health, sessions, queue";

  const healthExit = opts?.serverDown ? 1 : 0;
  const healthBody = opts?.serverDown
    ? "reachable: no — server not running"
    : "status: healthy\nport: 18810";

  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);

try { fs.appendFileSync(${JSON.stringify(transcriptPath)}, JSON.stringify(args) + "\\n"); } catch {}

if (args.length === 0) {
  console.log("Usage: ptah <command> [args]");
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
  console.log("ptah-fake-marker: " + rest.join(" | "));
  process.exit(0);
}

if (verb === "health") {
  console.log(${JSON.stringify(healthBody)});
  process.exit(${healthExit});
}

if (verb === "status") {
  console.log("queue: 0 pending");
  process.exit(0);
}

console.log("Unknown command: " + verb);
console.log("Commands: ${commands}");
process.exit(1);
`;
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return {
    dir,
    scriptPath,
    transcriptPath,
    ptahBin: `node ${scriptPath}`,
  };
}
