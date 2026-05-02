#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  { label: "Typecheck", command: npmCmd, args: ["run", "typecheck"] },
  { label: "Tests", command: npmCmd, args: ["test"] },
  { label: "Build", command: npmCmd, args: ["run", "build"] },
  { label: "List agents", command: npmCmd, args: ["run", "cli", "--", "list", "agents"] },
  { label: "List packs", command: npmCmd, args: ["run", "cli", "--", "list", "packs"] },
  { label: "Passing smoke", command: npmCmd, args: ["run", "smoke"] },
];

for (const step of steps) {
  console.log("");
  console.log(`==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    console.error("");
    console.error(`${step.label} failed with exit ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("");
console.log("Release verification passed.");
