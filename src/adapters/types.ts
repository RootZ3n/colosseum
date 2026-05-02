import type {
  AgentEvent,
  AgentRunResult,
  Capabilities,
  CostInfo,
  ModelInfo,
  RunOptions,
  SessionHandle,
} from "../types.js";

/**
 * The truth contract. Every adapter declares — at registration time, before
 * running any agent — what kind of evidence it can produce. This is what
 * scoring, receipts, and the UI rely on to label model/cost/event truthfulness.
 *
 *   modelIdentity:
 *     "declared"   — the adapter directly tells us model + provider (e.g. SDK response)
 *     "inferred"   — the adapter infers from headers, version strings, or env
 *     "unknown"    — the adapter has no reliable way to know
 *
 *   costTruth:
 *     "reported"   — exact numbers from the model API
 *     "estimated"  — adapter-side accounting via tokenizer math
 *     "unknown"    — no reliable source; cost stays "not reported" on receipts
 *
 *   eventStructure:
 *     "structured"   — adapter emits typed AgentEvents (tool_call, thought, final…)
 *     "unstructured" — adapter only sees opaque stdout/stderr text
 *
 *   toolSupport:
 *     true if the agent can call tools / edit files / execute shell, otherwise false.
 *
 * Adapters MUST NOT lie. If they don't know something, they say "unknown".
 */
export interface AdapterTruthContract {
  modelIdentity: "declared" | "inferred" | "unknown";
  costTruth: "reported" | "estimated" | "unknown";
  eventStructure: "structured" | "unstructured";
  toolSupport: boolean;
}

/**
 * Wire-protocol metadata for an adapter. Optional — declare it when an
 * adapter speaks something more specific than "subprocess that takes a
 * prompt as the last arg." Surfaced on `/api/agents` and shown to the
 * operator on the New Trial page so protocol mismatches are visible
 * before a trial runs (and so receipts can attribute failures correctly).
 */
export interface AdapterProtocol {
  /** Short identifier, e.g. "aedis-cli", "openai-chat". */
  name: string;
  /** Human-readable invocation e.g. "<bin> submit <prompt>". */
  submitCommand?: string;
  /** Free-form notes shown to the operator. */
  notes?: string[];
}

/**
 * AgentAdapter is the only interface Colosseum knows.
 * Adapters MUST be isolated from scoring logic — they translate from a specific agent
 * (Aedis, OpenClaw, Hermes, raw CLI, etc.) into the AgentEvent stream and metadata
 * that Colosseum's runner and scoring layer consume.
 *
 * Adapters MUST NOT inspect or modify scoring artifacts, receipts, or trial state.
 * They MUST report model/provider/cost truthfully — including admitting "unknown".
 */
export interface AgentAdapter {
  /** Unique identifier — referenced by CLI/API/UI. e.g. "aedis", "openclaw". */
  readonly id: string;
  /** Adapter version string. Stamped onto every receipt. */
  readonly version: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Free-form short description for the UI. */
  readonly description: string;
  readonly capabilities: Capabilities;
  /** Truth contract — what kind of evidence this adapter can produce. */
  readonly truth: AdapterTruthContract;
  /** Optional wire-protocol metadata. Surfaced when present, ignored otherwise. */
  readonly protocol?: AdapterProtocol;

  /** Confirm the adapter is ready to use (binary on PATH, env vars, etc.). */
  health(): Promise<{ ok: boolean; reason?: string }>;

  /** Open a session attached to a workspace. Idempotent w.r.t. session reuse forbidden. */
  startSession(opts: RunOptions): Promise<SessionHandle>;

  /** Send a prompt and wait for terminal completion. Adapters that stream should still resolve here. */
  sendPrompt(handle: SessionHandle, prompt: string): Promise<AgentRunResult>;

  /**
   * Stream events for a session.
   *
   * v0.1 status: **buffered replay only** — the runner does not consume this
   * concurrently with sendPrompt. Adapters typically replay the events
   * captured during sendPrompt(). Live concurrent streaming (events visible
   * on the Arena Floor *while* the agent is mid-call) is reserved for v0.2.
   *
   * TODO(v0.2): runner should consume streamEvents concurrently with
   * sendPrompt and forward each event as it arrives. Adapters that emit
   * events incrementally already have everything they need; the runner-side
   * pump is the missing piece.
   */
  streamEvents?(handle: SessionHandle): AsyncIterable<AgentEvent>;

  /** Cancel an in-flight session. Must be safe to call after natural completion. */
  stop(handle: SessionHandle): Promise<void>;

  /**
   * Walk the workspace and collect produced artifacts (files, logs).
   * Runner uses this to populate the receipt and to compute repo-hygiene scoring.
   */
  collectArtifacts(handle: SessionHandle): Promise<AgentRunResult["artifacts"]>;

  /** Latest model identity. Adapters may refine this after first response. */
  getModelInfo(handle: SessionHandle): Promise<ModelInfo>;

  /** Latest cost/token info. Adapters that don't have it must return reported:false. */
  getCostInfo(handle: SessionHandle): Promise<CostInfo>;
}

export type AgentAdapterFactory = () => AgentAdapter;
