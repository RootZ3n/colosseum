/**
 * Shared type definitions for the Colosseum core.
 * These types are imported across adapters, packs, runner, scoring, and receipts.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Verdict = "pass" | "fail" | "warn" | "skipped" | "error";

export type ModelLocation = "local" | "cloud" | "unknown";

export interface ModelInfo {
  /** Display name e.g. "claude-sonnet-4-6", "llama3:70b". May be "unknown". */
  model: string;
  /** Provider name e.g. "anthropic", "openai", "ollama", "lmstudio". May be "unknown". */
  provider: string;
  location: ModelLocation;
  /** Adapter version or build for traceability. */
  adapterVersion?: string;
}

export interface CostInfo {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Estimated USD cost. Omit if unknown. */
  estimatedCostUsd?: number;
  /** True if the adapter cannot report cost truthfully. */
  reported: boolean;
  /** Free-form note: "local model — zero cost", "not reported", etc. */
  note?: string;
}

export interface AgentEvent {
  ts: number;
  /** "stdout" | "stderr" | "tool_call" | "tool_result" | "thought" | "final" | "error" */
  kind: string;
  text?: string;
  data?: Record<string, unknown>;
}

export type TrialEventPhase =
  | "queued"
  | "starting"
  | "adapter_event"
  | "test_started"
  | "test_passed"
  | "test_failed"
  | "warning"
  | "guard_blocked"
  | "scoring"
  | "receipt_written"
  | "complete";

export type TrialEventSeverity = "info" | "pass" | "warn" | "fail" | "critical";

export interface TrialEvent {
  sequence: number;
  trialId: string;
  packId?: string;
  testId?: string;
  timestamp: number;
  phase: TrialEventPhase;
  severity: TrialEventSeverity;
  message: string;
  evidence?: {
    receiptId?: string;
    receiptPath?: string;
    artifactPath?: string;
    detail?: string;
  };
  adapter?: {
    id: string;
    version?: string;
  };
  model?: ModelInfo;
  source: "runner" | "adapter" | "velum" | "scoring" | "receipt";
  mode?: "live" | "buffered" | "replay";
  rawKind?: string;
}

export interface AgentArtifact {
  /** Path relative to the workspace. */
  path: string;
  bytes: number;
  /** Optional small inline preview. */
  preview?: string;
}

export interface SessionHandle {
  sessionId: string;
  workspace: string;
  modelInfo: ModelInfo;
}

export interface Capabilities {
  streaming: boolean;
  toolUse: boolean;
  fileEditing: boolean;
  shellExecution: boolean;
  modelSelection: boolean;
  reportsCost: boolean;
  reportsTokens: boolean;
}

export interface RunOptions {
  /** Working directory the agent is allowed to operate in. */
  workspace: string;
  /** Optional model selector (passed to adapters that support it). */
  model?: string;
  /** local/cloud preference where adapter supports both. */
  location?: ModelLocation;
  /** Hard wall-clock cap. Adapters must honor or document why not. */
  timeoutMs?: number;
  /** Extra adapter-specific config. */
  extra?: Record<string, unknown>;
}

export interface AgentRunResult {
  events: AgentEvent[];
  artifacts: AgentArtifact[];
  exitCode: number | null;
  modelInfo: ModelInfo;
  costInfo: CostInfo;
  durationMs: number;
  /** Truncated stdout/stderr summary for receipts. */
  stdout: string;
  stderr: string;
  /** Final answer text if the adapter produced one. */
  finalAnswer?: string;
}
