import type { AgentRunResult, Severity, Verdict } from "../types.js";

/**
 * A Test in Colosseum is a small, runnable check.
 * It owns:
 *   - the prompt to feed the agent
 *   - the assertions that decide pass/fail
 *   - the evidence it produces for the receipt
 *
 * Tests are dumb on purpose — they don't run the agent themselves.
 * The runner runs the agent, then hands the result here.
 */

/**
 * The classification taxonomy for FAIL verdicts.
 *
 * Every FAIL produced inside Colosseum MUST carry a failureType. The runner
 * injects a fallback if a third-party test forgets, and adds a reason noting
 * the omission — so the invariant holds even for misbehaving tests.
 */
/**
 * Outcome classification taxonomy.
 *
 * The field is named `failureType` for legacy reasons but really classifies
 * the *outcome* of any non-PASS test. It is REQUIRED on `verdict === "fail"`
 * and OPTIONAL on `verdict === "warn"` — warns may use it to spell out the
 * specific reason a test ended up partial (e.g. clarification-with-reason).
 */
export type FailureType =
  | "no_output"             // agent produced no final answer at all
  | "wrong_output"          // agent produced output that doesn't match expected
  | "silent_success"        // agent claimed success without doing the work
  | "unsafe_action"         // safety / Velum-class violation
  | "scope_violation"       // touched files outside the requested scope
  | "tool_failure_hidden"   // tool errored but the agent swallowed it
  | "incomplete_execution"  // assertion threw, runner crashed, exit code wrong
  | "timeout"               // wall-clock or step-bound exceeded
  | "adapter_setup_failed"  // preflight: binary missing, env unset, config bad —
                            //   the agent never got a fair chance. NEVER counted
                            //   as agent behavior; surfaced with remediation.
  | "clarification_required"; // agent declined-with-reason and asked for
                              //   clarification. NOT a hard failure: paired
                              //   with verdict="warn" and a partial score.
                              //   Becomes a hard fail only when (a) the test
                              //   demanded a concrete artifact and the agent
                              //   never produced one across attempts, OR
                              //   (b) the same agent re-asked the same
                              //   clarification ≥3 times in a single response
                              //   (a "clarification loop").

export interface TestContext {
  /** Absolute path to the per-test workspace. The runner manages cleanup. */
  workspace: string;
  /** Absolute path to a fixture directory the test may copy from. */
  fixtureRoot: string;
  /**
   * Adapter truth contract, when known. Tests can use this to interpret the
   * ABSENCE of evidence honestly — e.g. an `unstructured` adapter cannot
   * surface step events, so a stamina test should warn with a "limited
   * observability" note rather than penalize the agent for adapter limits.
   *
   * Shape: `{ modelIdentity, costTruth, eventStructure, toolSupport }`.
   * Imported as a plain object to avoid a packs→adapters dependency.
   */
  adapterTruth?: {
    modelIdentity: "declared" | "inferred" | "unknown";
    costTruth: "reported" | "estimated" | "unknown";
    eventStructure: "structured" | "unstructured";
    toolSupport: boolean;
  };
}

export interface TestEvidenceItem {
  label: string;
  /** Tiny inline blob; long evidence belongs in artifacts. */
  detail: string;
}

export interface TestResult {
  testId: string;
  verdict: Verdict;
  severity: Severity;
  /** 0..1 normalized score for this test. Treat verdict as authoritative. */
  score: number;
  reasons: string[];
  evidence: TestEvidenceItem[];
  /**
   * Required when verdict === "fail". Optional otherwise.
   * The runner injects a default if a FAIL is returned without a classification.
   */
  failureType?: FailureType;
}

export interface TestSpec {
  id: string;
  title: string;
  description: string;
  /** Used by scoring to attribute the score to a category. */
  category: TestCategory;
  severity: Severity;
  /** Optional pre-test setup against the workspace (copy fixtures, write files). */
  setup?(ctx: TestContext): Promise<void>;
  /** The prompt the agent receives. */
  prompt(ctx: TestContext): string | Promise<string>;
  /** After the agent runs, decide pass/fail and emit evidence. */
  assert(ctx: TestContext, run: AgentRunResult): Promise<TestResult>;
}

export type TestCategory =
  | "truthfulness"
  | "repo-editing"
  | "safety"
  | "stamina"
  | "local-model";

export interface TestPack {
  id: string;
  /** Pack-author-controlled version string. Bump when assertions change. */
  version: string;
  title: string;
  description: string;
  tests: TestSpec[];
}
