import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AgentAdapter } from "../adapters/types.js";
import type {
  TestContext,
  TestPack,
  TestResult,
  TestSpec,
  TestCategory,
} from "../packs/types.js";
import type {
  AgentEvent,
  CostInfo,
  ModelLocation,
  ModelInfo,
  TrialEvent,
  TrialEventSeverity,
  Verdict,
} from "../types.js";
import { collectArtifacts } from "./artifact-collector.js";
import { computeDiff, snapshotWorkspace } from "./diff.js";
import {
  DEFAULT_CLEANUP_POLICY,
  FixtureManager,
  type CleanupPolicy,
} from "./fixture-manager.js";
import { receiptFromTest, type Receipt } from "../receipts/receipt.js";
import { ReceiptStore } from "../receipts/receipt-store.js";
import { aggregate } from "../scoring/score.js";
import { overallVerdict } from "../scoring/verdict.js";
import { combine, scan } from "../velum/guard.js";
import { TrialStore, type TrialSummary } from "../storage/index.js";
import { redact } from "../velum/redaction.js";
import { COLOSSEUM_VERSION, getGitCommit } from "../version.js";

/**
 * The runner orchestrates a trial: for each test in each pack it
 *   1. creates a fresh per-test workspace (fixtures never touch the host repo),
 *   2. runs the agent adapter,
 *   3. asks the test spec to assert pass/fail and emit evidence,
 *   4. runs Velum on the inputs/outputs (recording, never hiding),
 *   5. writes a receipt and updates the live event stream.
 */

export interface TrialOptions {
  trialId?: string;
  adapter: AgentAdapter;
  packs: TestPack[];
  /** Adapter run options. The runner overrides .workspace per test. */
  baseRunOptions?: {
    model?: string;
    location?: ModelLocation;
    timeoutMs?: number;
    extra?: Record<string, unknown>;
  };
  stateRoot: string;
  /**
   * Workspace cleanup policy. Default is "success" — fixtures from PASS/WARN
   * tests are removed at end-of-trial; FAIL/ERROR fixtures are preserved as
   * evidence. Receipts and trial summaries are never affected by cleanup.
   */
  cleanupPolicy?: CleanupPolicy;
  /** Live event sink (used by API for streaming to UI). */
  onEvent?: (e: TrialEvent) => void;
}

export type { TrialEvent } from "../types.js";

export async function runTrial(opts: TrialOptions): Promise<TrialSummary> {
  const trialId = opts.trialId ?? `trial-${nanoid(10)}`;
  const trialStore = new TrialStore(opts.stateRoot);
  const receiptStore = new ReceiptStore(opts.stateRoot);
  const fixtures = new FixtureManager(opts.stateRoot);
  await trialStore.ensureLayout();
  const startedAt = Date.now();
  const timeline: TrialEvent[] = [];
  let sequence = 0;
  let liveMode: "live" | "buffered" = opts.adapter.capabilities.streaming ? "live" : "buffered";
  const emit = (event: Omit<TrialEvent, "sequence" | "trialId" | "timestamp"> & {
    timestamp?: number;
  }) => {
    const safe: TrialEvent = {
      sequence: ++sequence,
      trialId,
      timestamp: event.timestamp ?? Date.now(),
      ...event,
      message: redact(event.message).redacted,
    };
    timeline.push(safe);
    if (timeline.length > 1_000) timeline.splice(0, timeline.length - 1_000);
    opts.onEvent?.(safe);
  };

  const allResults: TestResult[] = [];
  const byCategory: Record<TestCategory, TestResult[]> = {
    truthfulness: [],
    "repo-editing": [],
    safety: [],
    stamina: [],
    "local-model": [],
  };
  const costs: CostInfo[] = [];
  const velumScans: Receipt["velum"][] = [];
  const packIds = opts.packs.map((p) => p.id);
  // Per-test verdict map drives the cleanup policy at the end of the trial.
  const finishedTestVerdicts = new Map<string, Verdict>();
  const packVersions: Record<string, string> = Object.fromEntries(
    opts.packs.map((p) => [p.id, p.version]),
  );
  // Resolved once per trial. Stamp it on every receipt for forensic auditability.
  const gitCommit = getGitCommit();
  const packForTest: Record<string, TestPack> = {};
  for (const p of opts.packs) for (const t of p.tests) packForTest[t.id] = p;

  emit({
    phase: "starting",
    severity: "info",
    message: `Trial starting with ${opts.adapter.id} across ${packIds.join(", ")}`,
    adapter: { id: opts.adapter.id, version: opts.adapter.version },
    source: "runner",
    mode: liveMode,
  });
  if (!opts.adapter.capabilities.streaming || !opts.adapter.streamEvents) {
    liveMode = "buffered";
    emit({
      phase: "warning",
      severity: "warn",
      message:
        "This adapter does not provide live step events; showing trial status and receipt timeline.",
      adapter: { id: opts.adapter.id, version: opts.adapter.version },
      source: "runner",
      mode: "buffered",
    });
  }

  // ── Preflight ──────────────────────────────────────────────────
  // Run the adapter's health check BEFORE any test. If it fails, the
  // agent never had a fair chance — every test would record empty
  // output and the failure modes would all be misclassified as agent
  // behavior (`no_output`, `tool_failure_hidden`, etc.). Instead we:
  //   1. Skip running tests entirely.
  //   2. Write one synthetic preflight receipt with full guidance.
  //   3. Mark the trial as `error` with `failureType=adapter_setup_failed`.
  //   4. Emit a `setup:failed` event so the CLI can surface remediation.
  const health = await opts.adapter.health();
  if (!health.ok) {
    const reason =
      health.reason ??
      "Adapter health check failed without a reason (treat as setup failure).";
    emit({
      phase: "warning",
      severity: "critical",
      testId: "preflight.adapter-health",
      packId: "preflight",
      message: reason,
      adapter: { id: opts.adapter.id, version: opts.adapter.version },
      source: "runner",
      mode: liveMode,
      rawKind: "setup:failed",
    });

    const preflightResult: TestResult = {
      testId: "preflight.adapter-health",
      verdict: "error",
      severity: "high",
      score: 0,
      failureType: "adapter_setup_failed",
      reasons: [reason],
      evidence: [
        { label: "adapter", detail: opts.adapter.id },
        { label: "health.ok", detail: "false" },
      ],
    };
    allResults.push(preflightResult);

    // Write a single preflight receipt so the operator has something to read.
    const synthVelum: Receipt["velum"] = {
      findings: [],
      decision: "allow",
      agentDecision: "allow",
      safeText: "",
    };
    const tStart = Date.now();
    const preflightReceipt = receiptFromTest({
      trialId,
      testId: "preflight.adapter-health",
      agentId: opts.adapter.id,
      adapter: opts.adapter.id,
      adapterVersion: opts.adapter.version,
      adapterTruth: opts.adapter.truth,
      packId: "preflight",
      packVersion: opts.adapter.version,
      colosseumVersion: COLOSSEUM_VERSION,
      gitCommit,
      prompt: "(preflight — no prompt was dispatched)",
      expectedBehavior:
        "Adapter must launch successfully before any test pack runs. " +
        "Setup failures (missing binary, bad config) are NOT counted as agent behavior.",
      modelInfo: {
        model: "unknown",
        provider: opts.adapter.id,
        location: opts.baseRunOptions?.location ?? "unknown",
        adapterVersion: opts.adapter.version,
      },
      costInfo: { reported: false, note: "preflight failure — agent never ran" },
      events: [],
      streamMode: liveMode,
      artifacts: [],
      stdout: "",
      stderr: "",
      result: preflightResult,
      velum: synthVelum,
      repoDiffSummary: "",
      startedAt: tStart,
      finishedAt: Date.now(),
    });
    await receiptStore.save(preflightReceipt);

    emit({
      phase: "receipt_written",
      severity: "critical",
      testId: "preflight.adapter-health",
      packId: "preflight",
      message: "Preflight setup receipt written",
      evidence: { receiptId: preflightReceipt.receiptId },
      adapter: { id: opts.adapter.id, version: opts.adapter.version },
      source: "receipt",
      mode: liveMode,
    });

    const finishedAt = Date.now();
    const summary: TrialSummary = {
      trialId,
      agentId: opts.adapter.id,
      adapter: opts.adapter.id,
      packs: packIds,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      verdict: "error",
      score: aggregate({ byCategory, costs }),
      testCount: 1,
      passCount: 0,
      failCount: 0,
      velumDecision: "allow",
      notes: `setup_failed reason="${reason.replace(/"/g, "'")}"`,
      colosseumVersion: COLOSSEUM_VERSION,
      gitCommit,
      adapterVersion: opts.adapter.version,
      packVersions,
      adapterTruth: opts.adapter.truth,
      liveMode,
    };
    await trialStore.saveTrial(summary);
    emit({
      phase: "complete",
      severity: "critical",
      message: `Trial complete: ERROR`,
      adapter: { id: opts.adapter.id, version: opts.adapter.version },
      source: "runner",
      mode: liveMode,
    });
    summary.eventCount = timeline.length;
    await trialStore.saveTrial(summary);
    await trialStore.saveTrialEvents(trialId, timeline);
    return summary;
  }

  for (const pack of opts.packs) {
    for (const test of pack.tests) {
      emit({
        phase: "test_started",
        severity: "info",
        testId: test.id,
        packId: pack.id,
        message: `${test.id} started`,
        adapter: { id: opts.adapter.id, version: opts.adapter.version },
        source: "runner",
        mode: liveMode,
      });
      const tStart = Date.now();
      const workspace = await fixtures.createWorkspace(trialId, test.id);
      // Hold the session reference outside the try so the finally can call
      // stop() even if startSession itself succeeded but sendPrompt threw.
      let session: Awaited<ReturnType<AgentAdapter["startSession"]>> | undefined;
      // One ctx for setup, prompt, and assert. Carrying adapterTruth here
      // lets tests interpret missing evidence honestly (e.g. stamina knows
      // an `unstructured` adapter cannot surface step events).
      const ctx = {
        workspace,
        fixtureRoot: workspace,
        adapterTruth: opts.adapter.truth,
      };
      try {
        if (test.setup) await test.setup(ctx);

        // Snapshot the seeded workspace so we can diff agent-induced changes.
        // If git is unavailable, the snapshot fails quietly and the diff is empty.
        snapshotWorkspace(workspace);

        session = await opts.adapter.startSession({
          workspace,
          model: opts.baseRunOptions?.model,
          location: opts.baseRunOptions?.location,
          timeoutMs: opts.baseRunOptions?.timeoutMs,
          extra: opts.baseRunOptions?.extra,
        });
        emit({
          phase: "adapter_event",
          severity: "info",
          testId: test.id,
          packId: pack.id,
          message: `Adapter session ${session.sessionId} started`,
          adapter: { id: opts.adapter.id, version: opts.adapter.version },
          model: session.modelInfo,
          source: "runner",
          mode: liveMode,
          rawKind: "session:start",
        });

        const promptRaw = await test.prompt(ctx);
        const promptScan = scan(promptRaw, { source: "prompt" });

        const streamed = new Set<string>();
        const stopPump = startAdapterEventPump({
          adapter: opts.adapter,
          session,
          testId: test.id,
          packId: pack.id,
          mode: liveMode,
          emit: (ev) => {
            streamed.add(agentEventKey(ev));
            emit({
              phase: "adapter_event",
              severity: severityForAgentEvent(ev),
              testId: test.id,
              packId: pack.id,
              message: formatAgentEvent(ev),
              adapter: { id: opts.adapter.id, version: opts.adapter.version },
              model: session?.modelInfo,
              source: "adapter",
              mode: liveMode,
              rawKind: ev.kind,
              timestamp: ev.ts,
            });
          },
        });
        const run = await opts.adapter.sendPrompt(session, promptRaw);
        await stopPump();
        for (const ev of run.events) {
          if (streamed.has(agentEventKey(ev))) continue;
          emit({
            phase: "adapter_event",
            severity: severityForAgentEvent(ev),
            testId: test.id,
            packId: pack.id,
            message: formatAgentEvent(ev),
            adapter: { id: opts.adapter.id, version: opts.adapter.version },
            model: run.modelInfo,
            source: "adapter",
            mode: "buffered",
            rawKind: ev.kind,
            timestamp: ev.ts,
          });
        }

        // Merge artifacts from the adapter (its own view) with a workspace
        // walk (ground truth on disk). De-dupe by path; adapter wins on
        // conflict so its `preview` field is preserved when available.
        const liveArtifacts = await collectArtifacts(workspace);
        let adapterArtifacts: typeof run.artifacts = [];
        try {
          adapterArtifacts = await opts.adapter.collectArtifacts(session);
        } catch {
          /* adapter walk is advisory; never block the run. */
        }
        const finalArtifacts = mergeArtifacts(
          run.artifacts.length ? run.artifacts : adapterArtifacts,
          liveArtifacts,
        );

        const outputScan = scan(
          [run.finalAnswer, run.stdout, run.stderr].filter(Boolean).join("\n"),
          { source: "output" },
        );
        // Scan artifact previews (≤256 bytes each) — destructive content
        // written into a file is real misbehavior, not a prompt-side probe.
        // Each artifact is scanned individually so its source attribution
        // and snippet remain useful for the receipt.
        const artifactScans = finalArtifacts
          .filter((a) => typeof a.preview === "string" && a.preview.length > 0)
          .map((a) => scan(a.preview as string, { source: "artifact" }));
        const velum = combine([promptScan, outputScan, ...artifactScans]);

        const result: TestResult = await runAssertion(test, ctx, run);
        allResults.push(result);
        byCategory[test.category].push(result);
        costs.push(run.costInfo);
        velumScans.push(velum);

        // Velum can override pass→fail when the AGENT itself produced a
        // fail-test finding. We use `agentDecision` (non-prompt findings
        // only) so a destructive probe sitting in the test prompt is
        // recorded as evidence without flipping a safe agent's verdict.
        if (velum.agentDecision === "fail-test" && result.verdict === "pass") {
          result.verdict = "fail";
          result.score = Math.min(result.score, 0.2);
          result.failureType = "unsafe_action";
          const offenders = velum.findings
            .filter((f) => f.decision === "fail-test" && f.source !== "prompt")
            .map((f) => `${f.rule}@${f.source}`);
          result.reasons.push(
            `Velum overrode pass→fail (agent-side findings): ${offenders.join(", ")}`,
          );
        }

        // Invariant: every FAIL must carry a failureType. If a third-party test
        // forgets, we inject a conservative default and add a reason noting it.
        if (result.verdict === "fail" && !result.failureType) {
          result.failureType = "wrong_output";
          result.reasons.push(
            "Test returned FAIL without a failureType — defaulted to wrong_output by the runner.",
          );
        }

        const safeStdout = redact(run.stdout).redacted;
        const safeStderr = redact(run.stderr).redacted;

        const diff = computeDiff(workspace);
        // Diffs themselves can carry secrets (the agent might write a leaked
        // token to disk); redact the diff text before it reaches the receipt.
        const safeDiff = redact(diff.text).redacted;

        const owningPack = packForTest[test.id];
        const receipt = receiptFromTest({
          trialId,
          testId: test.id,
          agentId: opts.adapter.id,
          adapter: opts.adapter.id,
          adapterVersion: opts.adapter.version,
          adapterTruth: opts.adapter.truth,
          packId: owningPack.id,
          packVersion: owningPack.version,
          colosseumVersion: COLOSSEUM_VERSION,
          gitCommit,
          prompt: promptRaw,
          expectedBehavior: test.description,
          modelInfo: run.modelInfo,
          costInfo: run.costInfo,
          events: run.events,
          streamMode: liveMode,
          artifacts: finalArtifacts,
          stdout: safeStdout,
          stderr: safeStderr,
          result,
          velum,
          repoDiffSummary: safeDiff,
          repoDiffStatus: diff.status,
          repoDiffUnavailableReason: diff.reason,
          startedAt: tStart,
          finishedAt: Date.now(),
        });
        await receiptStore.save(receipt);
        finishedTestVerdicts.set(test.id, result.verdict);

        emit({
          phase: "receipt_written",
          severity: severityForVerdict(result.verdict),
          testId: test.id,
          packId: pack.id,
          message: `Receipt written for ${test.id}`,
          evidence: { receiptId: receipt.receiptId },
          adapter: { id: opts.adapter.id, version: opts.adapter.version },
          model: run.modelInfo,
          source: "receipt",
          mode: liveMode,
        });
        emit({
          phase: verdictPhase(result.verdict),
          severity: severityForVerdict(result.verdict),
          testId: test.id,
          packId: pack.id,
          message: `${test.id} ${result.verdict.toUpperCase()}${result.reasons[0] ? ` — ${result.reasons[0]}` : ""}`,
          evidence: { receiptId: receipt.receiptId },
          adapter: { id: opts.adapter.id, version: opts.adapter.version },
          model: run.modelInfo,
          source: "runner",
          mode: liveMode,
        });
      } catch (err) {
        const errResult: TestResult = {
          testId: test.id,
          verdict: "error",
          severity: test.severity,
          score: 0,
          // "error" is not "fail", but classify it for downstream reporting.
          failureType: "incomplete_execution",
          reasons: [`Runner error: ${(err as Error).message}`],
          evidence: [],
        };
        allResults.push(errResult);
        byCategory[test.category].push(errResult);
        finishedTestVerdicts.set(test.id, "error");

        // Receipts-first invariant: every test that the runner touches must
        // produce a receipt, INCLUDING error cases. Without this, the receipts
        // directory is incomplete and operators cannot audit what happened —
        // the trial summary would count an error that has no on-disk evidence.
        const owningPack = packForTest[test.id];
        try {
          const errVelum: Receipt["velum"] = {
            findings: [],
            decision: "allow",
            agentDecision: "allow",
            safeText: "",
          };
          const errStack = (err as Error).stack ?? (err as Error).message ?? String(err);
          const errReceipt = receiptFromTest({
            trialId,
            testId: test.id,
            agentId: opts.adapter.id,
            adapter: opts.adapter.id,
            adapterVersion: opts.adapter.version,
            adapterTruth: opts.adapter.truth,
            packId: owningPack?.id ?? "unknown",
            packVersion: owningPack?.version ?? "unknown",
            colosseumVersion: COLOSSEUM_VERSION,
            gitCommit,
            prompt: "(runner errored before the test could complete)",
            expectedBehavior: test.description,
            modelInfo: {
              model: opts.baseRunOptions?.model ?? "unknown",
              provider: opts.adapter.id,
              location: opts.baseRunOptions?.location ?? "unknown",
              adapterVersion: opts.adapter.version,
            },
            costInfo: {
              reported: false,
              note: "test errored — incomplete execution",
            },
            events: [],
            streamMode: liveMode,
            artifacts: [],
            stdout: "",
            stderr: redact(errStack).redacted,
            result: errResult,
            velum: errVelum,
            repoDiffSummary: "",
            repoDiffStatus: "unavailable",
            repoDiffUnavailableReason: "test errored before diff capture",
            startedAt: tStart,
            finishedAt: Date.now(),
          });
          await receiptStore.save(errReceipt);
        } catch (receiptErr) {
          // A failed receipt write on the error path is itself a violation of
          // the receipts-first promise. We surface it as an event so it shows
          // up in the timeline; we do NOT throw, because the test outcome
          // above is already the source of truth.
          emit({
            phase: "warning",
            severity: "critical",
            testId: test.id,
            packId: pack.id,
            message: `failed to save error-path receipt: ${(receiptErr as Error).message}`,
            adapter: { id: opts.adapter.id, version: opts.adapter.version },
            source: "receipt",
            mode: liveMode,
            rawKind: "error",
          });
        }

        emit({
          phase: "test_failed",
          severity: "critical",
          testId: test.id,
          packId: pack.id,
          message: `${test.id} ERROR — ${errResult.reasons[0]}`,
          adapter: { id: opts.adapter.id, version: opts.adapter.version },
          source: "runner",
          mode: liveMode,
        });
      } finally {
        // Always call stop() if a session was started — adapters often hold
        // subprocesses, file handles, or network connections that leak if
        // we exit without closing. Errors during stop are non-fatal and
        // never mask the original test outcome.
        if (session) {
          try {
            await opts.adapter.stop(session);
          } catch (stopErr) {
            // Surface as an event so it shows up on the timeline; don't
            // throw — the test verdict above is the source of truth.
            emit({
              phase: "warning",
              severity: "warn",
              testId: test.id,
              packId: pack.id,
              message: `adapter.stop threw: ${(stopErr as Error).message}`,
              adapter: { id: opts.adapter.id, version: opts.adapter.version },
              source: "adapter",
              mode: liveMode,
              rawKind: "error",
            });
          }
        }
      }
    }
  }

  emit({
    phase: "scoring",
    severity: "info",
    message: "Scoring trial",
    adapter: { id: opts.adapter.id, version: opts.adapter.version },
    source: "scoring",
    mode: liveMode,
  });
  const score = aggregate({ byCategory, costs });
  const verdict = overallVerdict(allResults);
  const finishedAt = Date.now();
  const velumDecision = combine(velumScans).decision;

  const summary: TrialSummary = {
    trialId,
    agentId: opts.adapter.id,
    adapter: opts.adapter.id,
    packs: packIds,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    verdict,
    score,
    testCount: allResults.length,
    passCount: allResults.filter((r) => r.verdict === "pass").length,
    failCount: allResults.filter((r) => r.verdict === "fail").length,
    velumDecision,
    notes: opts.baseRunOptions?.location
      ? `location=${opts.baseRunOptions.location}`
      : undefined,
    colosseumVersion: COLOSSEUM_VERSION,
    gitCommit,
    adapterVersion: opts.adapter.version,
    packVersions,
    adapterTruth: opts.adapter.truth,
    liveMode,
  };
  await trialStore.saveTrial(summary);

  // Apply the cleanup policy AFTER the summary is saved. Receipts/trials
  // are never deleted — only per-test workspaces. Cleanup failures don't
  // affect the trial verdict; they're logged onto the summary's notes
  // and emitted as agent events for visibility.
  const policy: CleanupPolicy = opts.cleanupPolicy ?? DEFAULT_CLEANUP_POLICY;
  const cleanupResults = await fixtures.applyCleanupPolicy(
    trialId,
    finishedTestVerdicts,
    policy,
  );
  const removedCount = cleanupResults.filter((r) => r.removed).length;
  const preservedCount = cleanupResults.length - removedCount;
  summary.notes =
    [
      summary.notes,
      `cleanup=${policy} removed=${removedCount} preserved=${preservedCount}`,
    ]
      .filter(Boolean)
      .join("; ");
  await trialStore.saveTrial(summary);

  emit({
    phase: "complete",
    severity: severityForVerdict(verdict),
    message: `Trial complete: ${verdict.toUpperCase()} · trust ${Math.round(score.trust * 100)}%`,
    adapter: { id: opts.adapter.id, version: opts.adapter.version },
    source: "runner",
    mode: liveMode,
  });
  summary.eventCount = timeline.length;
  await trialStore.saveTrial(summary);
  await trialStore.saveTrialEvents(trialId, timeline);
  return summary;
}

function startAdapterEventPump(args: {
  adapter: AgentAdapter;
  session: Awaited<ReturnType<AgentAdapter["startSession"]>>;
  testId: string;
  packId: string;
  mode: "live" | "buffered";
  emit: (ev: AgentEvent) => void;
}): () => Promise<void> {
  if (args.mode !== "live" || !args.adapter.streamEvents) {
    return async () => {};
  }
  let closed = false;
  const pump = (async () => {
    try {
      for await (const ev of args.adapter.streamEvents!(args.session)) {
        if (closed) break;
        args.emit(ev);
      }
    } catch (err) {
      args.emit({
        ts: Date.now(),
        kind: "error",
        text: `adapter stream failed: ${(err as Error).message}`,
      });
    }
  })();
  return async () => {
    closed = true;
    await Promise.race([
      pump,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  };
}

function agentEventKey(ev: AgentEvent): string {
  return `${ev.ts}:${ev.kind}:${ev.text ?? ""}`;
}

function formatAgentEvent(ev: AgentEvent): string {
  const text = ev.text ? ` — ${ev.text.slice(0, 500)}` : "";
  return `${ev.kind}${text}`;
}

function severityForAgentEvent(ev: AgentEvent): TrialEventSeverity {
  const kind = ev.kind.toLowerCase();
  if (kind.includes("error") || kind.includes("failed")) return "fail";
  if (kind.includes("warn")) return "warn";
  if (kind.includes("final")) return "pass";
  return "info";
}

function severityForVerdict(verdict: Verdict): TrialEventSeverity {
  if (verdict === "pass") return "pass";
  if (verdict === "warn") return "warn";
  if (verdict === "fail") return "fail";
  if (verdict === "error") return "critical";
  return "info";
}

function verdictPhase(verdict: Verdict): TrialEvent["phase"] {
  if (verdict === "pass") return "test_passed";
  if (verdict === "warn") return "warning";
  return "test_failed";
}

async function runAssertion(
  test: TestSpec,
  ctx: TestContext,
  run: Awaited<ReturnType<AgentAdapter["sendPrompt"]>>,
): Promise<TestResult> {
  try {
    const r = await test.assert(ctx, run);
    return r;
  } catch (err) {
    return {
      testId: test.id,
      verdict: "error",
      severity: test.severity,
      score: 0,
      reasons: [`Assertion threw: ${(err as Error).message}`],
      evidence: [],
    };
  }
}

/**
 * Merge artifact lists by path. The first list (typically the adapter's
 * own view) takes precedence on conflict so its richer metadata
 * (`preview`, byte counts) is preserved.
 */
export function mergeArtifacts<T extends { path: string }>(
  primary: readonly T[],
  fallback: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of primary) {
    if (seen.has(a.path)) continue;
    seen.add(a.path);
    out.push(a);
  }
  for (const a of fallback) {
    if (seen.has(a.path)) continue;
    seen.add(a.path);
    out.push(a);
  }
  return out;
}
