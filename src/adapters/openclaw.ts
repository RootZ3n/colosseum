import { spawnSync } from "node:child_process";
import path from "node:path";
import { createGenericCliAdapter } from "./generic-cli.js";
import { parseShellWords } from "./aedis.js";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

/**
 * OpenClaw adapter. Drives the `openclaw` CLI by default.
 * Replace the inner shell-out with the real OpenClaw SDK once it stabilizes.
 */
export function createOpenClawAdapter(): AgentAdapter {
  const inner = createGenericCliAdapter();
  return {
    ...inner,
    id: "openclaw",
    version: "0.1.0",
    name: "OpenClaw",
    description:
      "OpenClaw agent driver. Dispatches prompts via `<openclaw> agent --local --message <prompt>`; override with OPENCLAW_BIN or extra.command.",
    capabilities: { ...inner.capabilities, fileEditing: true, toolUse: true },
    truth: {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    },
    protocol: {
      name: "openclaw-cli",
      submitCommand: "<openclaw> agent --local --message <prompt>",
      notes: [
        "Prompts are appended as the final argv element — no shell interpolation.",
        "OPENCLAW_BIN may include launcher args (e.g. \"node /path/to/cli.js\").",
        "Health probe verifies the CLI exposes `agent` and `--message` before any test runs.",
      ],
    },
    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const launch = resolveOpenClawLaunch(opts);
      const extra = (opts.extra ?? {}) as Record<string, any>;
      const sessionKey = `colosseum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callerArgs = (opts.extra as { args?: string[] } | undefined)?.args;
      const dispatchArgs = callerArgs ?? [
        "agent",
        "--local",
        "--session-id",
        sessionKey,
        "--message",
      ];
      const merged: RunOptions = {
        ...opts,
        extra: {
          provider: "openclaw",
          location: opts.location ?? "unknown",
          ...extra,
          env: {
            OPENCLAW_STATE_DIR: path.join(
              path.dirname(opts.workspace),
              `.openclaw-state-${path.basename(opts.workspace)}`,
            ),
            ...(extra.env ?? {}),
          },
          command: launch.command,
          args: [...launch.args, ...dispatchArgs],
        },
      };
      return inner.startSession(merged);
    },
    async health() {
      const launch = resolveOpenClawLaunch({});
      const which = spawnSync("sh", ["-c", `command -v -- ${shellQuote(launch.command)}`], {
        encoding: "utf8",
      });
      if (which.status !== 0 || !which.stdout.trim()) {
        return {
          ok: false,
          reason:
            `OpenClaw adapter could not launch: command not found "${launch.command}". ` +
            `Install the OpenClaw CLI, put it on PATH, or set OPENCLAW_BIN to ` +
            `the absolute path of your launcher (may include args, e.g. ` +
            `OPENCLAW_BIN="node /path/to/openclaw/dist/cli.js").`,
        };
      }
      const rootProbe = spawnSync(launch.command, [...launch.args, "--help"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      const rootText = `${rootProbe.stdout ?? ""}\n${rootProbe.stderr ?? ""}`;
      const commandsLine = rootText.match(/Commands?:\s*([\s\S]+?)(?:\n\n|Examples:|Docs:|$)/i);
      if (!commandsLine || !/\bagent\b/.test(commandsLine[1])) {
        return {
          ok: false,
          reason:
            `OpenClaw adapter found "${launch.command}", but its help output did not ` +
            `advertise the \`agent\` command. This adapter will not run tests against ` +
            `an unknown CLI protocol.`,
        };
      }
      const agentProbe = spawnSync(launch.command, [...launch.args, "agent", "--help"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      const agentText = `${agentProbe.stdout ?? ""}\n${agentProbe.stderr ?? ""}`;
      if (!agentText.includes("--message")) {
        return {
          ok: false,
          reason:
            `OpenClaw adapter found "${launch.command} agent", but the command help ` +
            `does not expose --message. Configure extra.args explicitly if your ` +
            `OpenClaw build uses a different prompt flag.`,
        };
      }
      return {
        ok: true,
        reason: `binary resolved to ${which.stdout.trim()}; dispatches via ${launch.command} ${[
          ...launch.args,
          "agent",
          "--local",
          "--message",
          "<prompt>",
        ].join(" ")}`,
      };
    },
  };
}

export interface OpenClawLaunch {
  command: string;
  args: string[];
  source: "extra.command" | "OPENCLAW_BIN" | "default";
}

export function resolveOpenClawLaunch(opts: { extra?: unknown }): OpenClawLaunch {
  const extra = (opts.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.command === "string" && extra.command) {
    return { command: extra.command, args: [], source: "extra.command" };
  }
  const bin = process.env.OPENCLAW_BIN;
  if (typeof bin === "string" && bin.trim().length > 0) {
    const tokens = parseShellWords(bin.trim());
    if (tokens.length > 0) {
      return {
        command: tokens[0],
        args: tokens.slice(1),
        source: "OPENCLAW_BIN",
      };
    }
  }
  return { command: "openclaw", args: [], source: "default" };
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
