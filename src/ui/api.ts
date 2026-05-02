/* Tiny typed API client used by every page. */

export interface AdapterTruthContract {
  modelIdentity: "declared" | "inferred" | "unknown";
  costTruth: "reported" | "estimated" | "unknown";
  eventStructure: "structured" | "unstructured";
  toolSupport: boolean;
}

export interface AdapterProtocol {
  name: string;
  submitCommand?: string;
  notes?: string[];
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  capabilities: Record<string, boolean>;
  truth?: AdapterTruthContract;
  protocol?: AdapterProtocol;
}

export interface PackTest {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
}

export interface PackSummary {
  id: string;
  title: string;
  description: string;
  tests: PackTest[];
}

export interface TrialScore {
  passRate: number;
  trust: number;
  perCategory: Array<{ category: string; value: number; n: number; reasons: string[] }>;
  costEfficiency: { value: number; n: number; reasons: string[] };
  reasons: string[];
}

export interface TrialSummary {
  trialId: string;
  agentId: string;
  adapter: string;
  packs: string[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  verdict: "pass" | "fail" | "warn" | "skipped" | "error";
  score: TrialScore;
  testCount: number;
  passCount: number;
  failCount: number;
  velumDecision: "allow" | "warn" | "block" | "fail-test";
  notes?: string;
}

export interface Receipt {
  receiptId: string;
  trialId: string;
  testId: string;
  agentId: string;
  adapter: string;
  modelInfo: { model: string; provider: string; location: string };
  costInfo: {
    promptTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    reported: boolean;
    note?: string;
  };
  prompt: string;
  expectedBehavior: string;
  observedBehavior: string;
  verdict: "pass" | "fail" | "warn" | "skipped" | "error" | string;
  failureType?:
    | "no_output"
    | "wrong_output"
    | "silent_success"
    | "unsafe_action"
    | "scope_violation"
    | "tool_failure_hidden"
    | "incomplete_execution"
    | "timeout";
  reasons: string[];
  artifacts: { path: string; bytes: number; preview?: string }[];
  stdoutSummary: string;
  stderrSummary: string;
  velum: {
    decision: string;
    agentDecision?: string;
    findings: {
      rule: string;
      severity: string;
      decision: string;
      snippet: string;
      reason: string;
      source?: string;
    }[];
    safeText: string;
  };
  events: { ts: number; kind: string; text?: string }[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  agents: () => j<{ agents: AgentSummary[] }>("/api/agents").then((r) => r.agents),
  packs: () => j<{ packs: PackSummary[] }>("/api/packs").then((r) => r.packs),
  trials: () => j<{ trials: TrialSummary[] }>("/api/trials").then((r) => r.trials),
  trial: (id: string) => j<TrialSummary>(`/api/trials/${id}`),
  startTrial: (body: {
    agent: string;
    packs: string[];
    model?: string;
    location?: "local" | "cloud" | "unknown";
  }) =>
    j<{ trialId: string }>("/api/trials", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  receipts: (trialId: string) =>
    j<{ receipts: Receipt[] }>(`/api/receipts/${trialId}`).then((r) => r.receipts),
  receipt: (trialId: string, testId: string) =>
    j<Receipt>(`/api/receipts/${trialId}/${encodeURIComponent(testId)}`),
};

export function streamTrialEvents(
  trialId: string,
  onEvent: (e: any) => void,
): () => void {
  const es = new EventSource(`/api/trials/${trialId}/events`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {}
  };
  es.addEventListener("end", () => es.close());
  es.onerror = () => es.close();
  return () => es.close();
}
