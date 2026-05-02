import { nanoid } from "nanoid";
import type {
  AgentEvent,
  AgentRunResult,
  CostInfo,
  ModelInfo,
  RunOptions,
  SessionHandle,
} from "../types.js";
import type { AgentAdapter } from "./types.js";

type SquidleyVariant = "public" | "v2";

interface SquidleySession {
  variant: SquidleyVariant;
  endpoint: string;
  workspace: string;
  modelInfo: ModelInfo;
  cost: CostInfo;
  timeoutMs: number;
  events: AgentEvent[];
}

const sessions = new Map<string, SquidleySession>();

export function createSquidleyAdapter(): AgentAdapter {
  return createSquidleyHttpAdapter({
    id: "squidley",
    name: "Squidley",
    version: "0.1.0",
    description:
      "Squidley public adapter. Sends prompts to the local public Squidley `/api/chat` route.",
    variant: "public",
    envVar: "SQUIDLEY_URL",
    defaultEndpoint: "http://127.0.0.1:3000",
  });
}

export function createSquidleyV2Adapter(): AgentAdapter {
  return createSquidleyHttpAdapter({
    id: "squidley-v2",
    name: "Squidley v2",
    version: "2.0.0",
    description:
      "Squidley-v2 lab adapter. Sends prompts to the local Squidley-v2 Fastify `/chat` route.",
    variant: "v2",
    envVar: "SQUIDLEY_V2_URL",
    defaultEndpoint: "http://127.0.0.1:18791",
  });
}

function createSquidleyHttpAdapter(config: {
  id: string;
  name: string;
  version: string;
  description: string;
  variant: SquidleyVariant;
  envVar: string;
  defaultEndpoint: string;
}): AgentAdapter {
  return {
    id: config.id,
    version: config.version,
    name: config.name,
    description: config.description,
    capabilities: {
      streaming: false,
      toolUse: config.variant === "v2",
      fileEditing: config.variant === "v2",
      shellExecution: config.variant === "v2",
      modelSelection: true,
      reportsCost: config.variant === "v2",
      reportsTokens: true,
    },
    truth: {
      modelIdentity: "inferred",
      costTruth: config.variant === "v2" ? "reported" : "unknown",
      eventStructure: "unstructured",
      toolSupport: config.variant === "v2",
    },
    protocol: {
      name: config.variant === "v2" ? "squidley-v2-http" : "squidley-http",
      submitCommand:
        config.variant === "v2"
          ? `POST $${config.envVar}/chat`
          : `POST $${config.envVar}/api/chat`,
      notes: [
        `${config.envVar} overrides the base URL; default is ${config.defaultEndpoint}.`,
        "Health probe verifies the local HTTP service before any test runs.",
        "Prompts are sent as JSON, not through a shell.",
      ],
    },

    async health() {
      const endpoint = normalizeEndpoint(process.env[config.envVar] ?? config.defaultEndpoint);
      const healthPath = config.variant === "v2" ? "/health" : "/api/local/health";
      const url = `${endpoint}${healthPath}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            reason:
              `${config.name} adapter reached ${url}, but it returned HTTP ${res.status}. ` +
              `${text.slice(0, 240) || "Start/configure the local Squidley service before testing."}`,
          };
        }
        return { ok: true, reason: `${config.name} HTTP service reachable at ${url}` };
      } catch (err) {
        return {
          ok: false,
          reason:
            `${config.name} adapter could not reach ${url}. Start the local service or set ` +
            `${config.envVar}. Error: ${(err as Error).message}`,
        };
      }
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const extra = (opts.extra ?? {}) as Record<string, unknown>;
      const endpoint = normalizeEndpoint(
        typeof extra.endpoint === "string"
          ? extra.endpoint
          : process.env[config.envVar] ?? config.defaultEndpoint,
      );
      const sessionId = `${config.id}-${nanoid(10)}`;
      const modelInfo: ModelInfo = {
        model: opts.model ?? "unknown",
        provider: config.id,
        location: opts.location ?? "local",
        adapterVersion: config.version,
      };
      sessions.set(sessionId, {
        variant: config.variant,
        endpoint,
        workspace: opts.workspace,
        modelInfo,
        cost: { reported: false, note: `${config.name} has not reported cost yet` },
        timeoutMs:
          typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 60_000,
        events: [],
      });
      return { sessionId, workspace: opts.workspace, modelInfo };
    },

    async sendPrompt(handle: SessionHandle, prompt: string): Promise<AgentRunResult> {
      const session = sessions.get(handle.sessionId);
      if (!session) throw new Error(`unknown session ${handle.sessionId}`);

      const started = Date.now();
      const events: AgentEvent[] = [
        { ts: started, kind: "stdout", text: `POST ${chatPath(session.variant)}` },
      ];
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = 0;
      let finalAnswer: string | undefined;

      try {
        const res = await fetch(`${session.endpoint}${chatPath(session.variant)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody(session.variant, prompt, session.modelInfo.model)),
          signal: AbortSignal.timeout(session.timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) {
          exitCode = res.status;
          stderr = `HTTP ${res.status}: ${text.slice(-4000)}`;
          events.push({ ts: Date.now(), kind: "error", text: stderr.slice(0, 500) });
        } else {
          const data = JSON.parse(text) as Record<string, unknown>;
          const parsed = parseSquidleyResponse(session.variant, data);
          finalAnswer = parsed.finalAnswer;
          stdout = parsed.stdout;
          session.modelInfo = {
            ...session.modelInfo,
            model: parsed.model ?? session.modelInfo.model,
          };
          session.cost = parsed.cost;
          events.push({
            ts: Date.now(),
            kind: "final",
            text: finalAnswer ? finalAnswer.slice(0, 500) : "(empty response)",
          });
          if (!finalAnswer) {
            exitCode = 1;
            stderr = "Squidley response did not include a final answer.";
          }
        }
      } catch (err) {
        exitCode = 1;
        stderr = `Squidley request failed: ${(err as Error).message}`;
        events.push({ ts: Date.now(), kind: "error", text: stderr });
      }

      session.events.push(...events);
      return {
        events,
        artifacts: [],
        exitCode,
        modelInfo: session.modelInfo,
        costInfo: { ...session.cost },
        durationMs: Date.now() - started,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        finalAnswer,
      };
    },

    async *streamEvents(handle: SessionHandle): AsyncGenerator<AgentEvent> {
      const session = sessions.get(handle.sessionId);
      if (!session) return;
      for (const event of session.events) yield event;
    },

    async stop() {},

    async collectArtifacts() {
      return [];
    },

    async getModelInfo(handle: SessionHandle) {
      return sessions.get(handle.sessionId)!.modelInfo;
    },

    async getCostInfo(handle: SessionHandle) {
      return { ...sessions.get(handle.sessionId)!.cost };
    },
  };
}

function normalizeEndpoint(url: string): string {
  return url.replace(/\/+$/, "");
}

function chatPath(variant: SquidleyVariant): string {
  return variant === "v2" ? "/chat" : "/api/chat";
}

function requestBody(variant: SquidleyVariant, prompt: string, model: string): Record<string, unknown> {
  if (variant === "v2") {
    return {
      messages: [{ role: "user", content: prompt }],
      stream: false,
      systemPrompt: "__colloquium__",
      noMemory: true,
      ...(model !== "unknown" ? { model } : {}),
    };
  }
  return {
    message: prompt,
    ...(model !== "unknown" ? { model } : {}),
  };
}

function parseSquidleyResponse(
  variant: SquidleyVariant,
  data: Record<string, unknown>,
): { finalAnswer?: string; stdout: string; model?: string; cost: CostInfo } {
  if (variant === "v2") {
    const finalAnswer = typeof data.text === "string" ? data.text : undefined;
    const tokensIn = typeof data.tokensIn === "number" ? data.tokensIn : undefined;
    const tokensOut = typeof data.tokensOut === "number" ? data.tokensOut : undefined;
    return {
      finalAnswer,
      stdout: JSON.stringify(data, null, 2),
      model: typeof data.model === "string" ? data.model : undefined,
      cost: {
        promptTokens: tokensIn,
        outputTokens: tokensOut,
        totalTokens:
          typeof tokensIn === "number" && typeof tokensOut === "number"
            ? tokensIn + tokensOut
            : undefined,
        estimatedCostUsd:
          typeof data.estimatedCostUsd === "number" ? data.estimatedCostUsd : undefined,
        reported:
          typeof tokensIn === "number" ||
          typeof tokensOut === "number" ||
          typeof data.estimatedCostUsd === "number",
        note:
          typeof tokensIn === "number" ||
          typeof tokensOut === "number" ||
          typeof data.estimatedCostUsd === "number"
            ? "Squidley-v2 reported token/cost fields"
            : "Squidley-v2 did not report token/cost fields",
      },
    };
  }

  if (data.ok === false) {
    const err = data.error as { message?: string } | undefined;
    return {
      finalAnswer: undefined,
      stdout: JSON.stringify(data, null, 2),
      model: undefined,
      cost: { reported: false, note: err?.message ?? "Squidley returned an error" },
    };
  }

  const finalAnswer = typeof data.reply === "string" ? data.reply : undefined;
  const promptTokens = typeof data.promptEvalCount === "number" ? data.promptEvalCount : undefined;
  const outputTokens = typeof data.evalCount === "number" ? data.evalCount : undefined;
  return {
    finalAnswer,
    stdout: JSON.stringify(data, null, 2),
    model: typeof data.model === "string" ? data.model : undefined,
    cost: {
      promptTokens,
      outputTokens,
      totalTokens:
        typeof promptTokens === "number" && typeof outputTokens === "number"
          ? promptTokens + outputTokens
          : undefined,
      reported: typeof promptTokens === "number" || typeof outputTokens === "number",
      note:
        typeof promptTokens === "number" || typeof outputTokens === "number"
          ? "Squidley public reported local token counts"
          : "Squidley public does not report cost",
    },
  };
}
