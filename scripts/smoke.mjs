#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "pass";

if (!["pass", "fail"].includes(mode)) {
  console.error("Usage: node scripts/smoke.mjs pass|fail");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcCli = path.join(repoRoot, "src", "cli", "index.ts");
const stateRoot = path.join(
  os.tmpdir(),
  `colosseum-smoke-${mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

// This is a source-install smoke test. Use the TypeScript CLI via tsx so the
// command works before or after `npm run build` and cannot accidentally run a
// stale dist/ artifact from a previous build.
const cliArgs = ["--import", "tsx", srcCli];

const trialArgs =
  mode === "pass"
    ? ["run", "--agent", "mock", "--pack", "stamina", "--state", stateRoot, "--quiet"]
    : ["run", "--agent", "mock", "--pack", "truthfulness", "--state", stateRoot, "--quiet"];

const expectedStatus = mode === "pass" ? 0 : 2;
const expectedVerdict = mode === "pass" ? "PASS" : "FAIL";

console.log(
  mode === "pass"
    ? "Running Colosseum passing smoke test (mock agent + stamina pack)..."
    : "Running Colosseum intentional failing demo (mock agent + truthfulness pack)...",
);
console.log(`State directory: ${stateRoot}`);
console.log("");

const result = spawnSync(process.execPath, [...cliArgs, ...trialArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
});

const status = result.status ?? 1;
let verdict = "unknown";
try {
  const trialsDir = path.join(stateRoot, "trials");
  const trialFiles = readdirSync(trialsDir).filter((name) => name.endsWith(".json"));
  trialFiles.sort();
  const summary = JSON.parse(
    readFileSync(path.join(trialsDir, trialFiles[trialFiles.length - 1]), "utf8"),
  );
  verdict = String(summary.verdict ?? "unknown").toUpperCase();
} catch {
  verdict = "unknown";
}

if (status !== expectedStatus || verdict !== expectedVerdict) {
  console.error("");
  console.error(
    `Smoke check failed: expected exit ${expectedStatus} and verdict ${expectedVerdict}, got exit ${status} and verdict ${verdict}.`,
  );
  process.exit(1);
}

if (mode === "fail") {
  console.log("");
  console.log("Intentional failing demo behaved as expected: Colosseum exited 2 and wrote failure receipts.");
} else {
  console.log("");
  console.log("Passing smoke test succeeded.");
}
