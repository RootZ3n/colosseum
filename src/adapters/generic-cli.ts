import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
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

interface CliSession {
  workspace: string;
  events: AgentEvent[];
  modelInfo: ModelInfo;
  cost: CostInfo;
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  child?: ReturnType<typeof spawn>;
}

const sessions = new Map<string, CliSession>();

/**
 * Generic CLI adapter — drives any agent that exposes itself as `cmd args... -- "<prompt>"`.
 * Configure via RunOptions.extra:
 *   {
 *     command: "claude",
 *     args: ["--print"],          // optional; prompt is appended as a final argument
 *     model?: "claude-sonnet-4-6",
 *     provider?: "anthropic",
 *     location?: "cloud" | "local" | "unknown",
 *   }
 *
 * It does NOT introspect cost/tokens — it sets reported:false and notes "not reported".
 * That truthful disclosure is more important than fabricating a number.
 */
export function createGenericCliAdapter(): AgentAdapter {
  return {
    id: "generic-cli",
    version: "0.1.0",
    name: "Generic CLI",
    description:
      "Drives any CLI-shaped agent. Truthfully admits unknown model/cost when not configured.",
    capabilities: {
      streaming: true,
      toolUse: false,
      fileEditing: false,
      shellExecution: true,
      modelSelection: true,
      reportsCost: false,
      reportsTokens: false,
    },
    truth: {
      // We literally just spawn a process. We don't know what model it's using
      // or what it costs, and we only see opaque stdout/stderr text.
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: false,
    },

    async health() {
      return { ok: true };
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const sessionId = `cli-${nanoid(10)}`;
      const extra = (opts.extra ?? {}) as Record<string, any>;
      const command: string = extra.command ?? "echo";
      const args: string[] = Array.isArray(extra.args) ? extra.args : [];
      const env: Record<string, string> = { ...process.env, ...(extra.env ?? {}) } as any;

      const modelInfo: ModelInfo = {
        model: opts.model ?? extra.model ?? "unknown",
        provider: extra.provider ?? "unknown",
        location: opts.location ?? extra.location ?? "unknown",
        adapterVersion: "0.1.0",
      };

      sessions.set(sessionId, {
        workspace: opts.workspace,
        events: [],
        modelInfo,
        cost: {
          reported: false,
          note: "generic CLI adapter does not introspect cost/tokens",
        },
        command,
        args,
        env,
        timeoutMs: typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
          ? opts.timeoutMs
          : 60_000,
      });

      return { sessionId, workspace: opts.workspace, modelInfo };
    },

    async sendPrompt(handle: SessionHandle, prompt: string): Promise<AgentRunResult> {
      const session = sessions.get(handle.sessionId);
      if (!session) throw new Error(`unknown session ${handle.sessionId}`);
      const start = Date.now();
      const events: AgentEvent[] = [];

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const result = await new Promise<{ code: number | null }>((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(session.command, [...session.args, prompt], {
            cwd: session.workspace,
            env: session.env,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          // synchronous spawn failure (rare; mostly path validation issues)
          stderr += `spawn failed: ${(err as Error).message}\n`;
          events.push({ ts: Date.now(), kind: "error", text: String(err) });
          resolve({ code: 127 });
          return;
        }
        session.child = child;

        const timer = setTimeout(() => {
          timedOut = true;
          const note = `timeout after ${session.timeoutMs}ms — sending SIGTERM\n`;
          stderr += note;
          events.push({ ts: Date.now(), kind: "error", text: note });
          if (!child.killed) child.kill("SIGTERM");
          // hard kill if it doesn't exit promptly
          setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2_000).unref();
        }, session.timeoutMs);
        timer.unref();

        child.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stdout += text;
          const ev: AgentEvent = { ts: Date.now(), kind: "stdout", text };
          events.push(ev);
          session.events.push(ev);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stderr += text;
          const ev: AgentEvent = { ts: Date.now(), kind: "stderr", text };
          events.push(ev);
          session.events.push(ev);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code: timedOut ? 124 : code });
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          // ENOENT etc. — record honestly with exit code 127
          const isENOENT = (err as NodeJS.ErrnoException).code === "ENOENT";
          stderr += isENOENT
            ? `binary not found: ${session.command}\n`
            : `spawn error: ${err.message}\n`;
          events.push({
            ts: Date.now(),
            kind: "error",
            text: isENOENT ? `ENOENT: ${session.command}` : err.message,
          });
          resolve({ code: 127 });
        });
      });

      const durationMs = Date.now() - start;
      const finalAnswer = stdout.trim().length > 0 ? stdout.trim().slice(-2000) : undefined;

      return {
        events,
        artifacts: await this.collectArtifacts(handle),
        exitCode: result.code,
        modelInfo: session.modelInfo,
        costInfo: { ...session.cost },
        durationMs,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        finalAnswer,
      };
    },

    async *streamEvents(handle: SessionHandle): AsyncGenerator<AgentEvent> {
      const session = sessions.get(handle.sessionId);
      if (!session) return;
      for (const ev of session.events) yield ev;
    },

    async stop(handle: SessionHandle) {
      const session = sessions.get(handle.sessionId);
      if (session?.child && !session.child.killed) {
        session.child.kill("SIGTERM");
      }
    },

    async collectArtifacts(handle: SessionHandle) {
      const session = sessions.get(handle.sessionId);
      if (!session) return [];
      const out: AgentRunResult["artifacts"] = [];
      const walk = async (dir: string) => {
        let entries: string[] = [];
        try {
          entries = await fs.readdir(dir);
        } catch {
          return;
        }
        for (const e of entries) {
          // Skip the runner's per-test git snapshot — harness state, not agent output.
          if (e === ".git") continue;
          const full = path.join(dir, e);
          const stat = await fs.stat(full).catch(() => null);
          if (!stat) continue;
          if (stat.isDirectory()) {
            await walk(full);
          } else {
            const rel = path.relative(session.workspace, full);
            out.push({ path: rel, bytes: stat.size });
          }
        }
      };
      await walk(session.workspace);
      return out;
    },

    async getModelInfo(handle: SessionHandle) {
      return sessions.get(handle.sessionId)!.modelInfo;
    },

    async getCostInfo(handle: SessionHandle) {
      return { ...sessions.get(handle.sessionId)!.cost };
    },
  };
}
