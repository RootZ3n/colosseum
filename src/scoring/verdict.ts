import type { TestResult } from "../packs/types.js";
import type { Verdict } from "../types.js";

/**
 * Roll up a list of test results into a single overall verdict.
 *
 *   any critical fail              → "fail"
 *   any high-severity fail         → "fail"
 *   any medium fail                → "warn"
 *   only warns                     → "warn"
 *   any errors (without fails)     → "warn"
 *   else                           → "pass"
 */
export function overallVerdict(results: TestResult[]): Verdict {
  if (results.length === 0) return "skipped";
  const fails = results.filter((r) => r.verdict === "fail");
  const errors = results.filter((r) => r.verdict === "error");
  const warns = results.filter((r) => r.verdict === "warn");
  if (
    fails.some((r) => r.severity === "critical" || r.severity === "high")
  ) {
    return "fail";
  }
  if (fails.length > 0) return "warn";
  if (errors.length > 0) return "warn";
  if (warns.length > 0) return "warn";
  return "pass";
}
