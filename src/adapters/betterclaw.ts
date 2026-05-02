import { spawnSync } from "node:child_process";
import path from "node:path";
import { createGenericCliAdapter } from "./generic-cli.js";
import { parseShellWords } from "./aedis.js";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

/**
 * BetterClaw adapter. Mirrors the OpenClaw CLI contract while keeping its
 * binary/env resolution separate so both agents can be tested side by side.
 */
export function createBetterClawAdapter(): AgentAdapter {
  const inner = createGenericCliAdapter();
  return {
    ...inner,
    id: "betterclaw",
    version: "0.1.0",
    name: "BetterClaw",
    description:
      "BetterClaw agent driver. Dispatches prompts via `<betterclaw> agent --local --message <prompt>`; override with BETTERCLAW_BIN or extra.command.",
    capabilities: { ...inner.capabilities, fileEditing: true, toolUse: true },
    truth: {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    },
    protocol: {
      name: "betterclaw-cli",
      submitCommand: "<betterclaw> agent --local --message <prompt>",
      notes: [
        "Prompts are appended as the final argv element — no shell interpolation.",
        "BETTERCLAW_BIN may include launcher args (e.g. \"node /path/to/cli.js\").",
        "Health probe verifies the CLI exposes `agent` and `--message` before any test runs.",
      ],
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const launch = resolveBetterClawLaunch(opts);
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
      const stateDir = path.join(
        path.dirname(opts.workspace),
        `.betterclaw-state-${path.basename(opts.workspace)}`,
      );
      const merged: RunOptions = {
        ...opts,
        extra: {
          provider: "betterclaw",
          location: opts.location ?? "unknown",
          ...extra,
          env: {
            BETTERCLAW_STATE_DIR: stateDir,
            OPENCLAW_STATE_DIR: stateDir,
            ...(extra.env ?? {}),
          },
          command: launch.command,
          args: [...launch.args, ...dispatchArgs],
        },
      };
      return inner.startSession(merged);
    },

    async health() {
      const launch = resolveBetterClawLaunch({});
      const which = spawnSync("sh", ["-c", `command -v -- ${shellQuote(launch.command)}`], {
        encoding: "utf8",
      });
      if (which.status !== 0 || !which.stdout.trim()) {
        return {
          ok: false,
          reason:
            `BetterClaw adapter could not launch: command not found "${launch.command}". ` +
            `Install the BetterClaw CLI, put it on PATH, or set BETTERCLAW_BIN to ` +
            `the absolute path of your launcher (may include args, e.g. ` +
            `BETTERCLAW_BIN="node /path/to/betterclaw/dist/cli.js").`,
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
            `BetterClaw adapter found "${launch.command}", but its help output did not ` +
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
            `BetterClaw adapter found "${launch.command} agent", but the command help ` +
            `does not expose --message. Configure extra.args explicitly if your ` +
            `BetterClaw build uses a different prompt flag.`,
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

export interface BetterClawLaunch {
  command: string;
  args: string[];
  source: "extra.command" | "BETTERCLAW_BIN" | "default";
}

export function resolveBetterClawLaunch(opts: { extra?: unknown }): BetterClawLaunch {
  const extra = (opts.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.command === "string" && extra.command) {
    return { command: extra.command, args: [], source: "extra.command" };
  }
  const bin = process.env.BETTERCLAW_BIN;
  if (typeof bin === "string" && bin.trim().length > 0) {
    const tokens = parseShellWords(bin.trim());
    if (tokens.length > 0) {
      return {
        command: tokens[0],
        args: tokens.slice(1),
        source: "BETTERCLAW_BIN",
      };
    }
  }
  return { command: "betterclaw", args: [], source: "default" };
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
