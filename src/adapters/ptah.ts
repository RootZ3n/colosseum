import { spawnSync } from "node:child_process";
import { createGenericCliAdapter } from "./generic-cli.js";
import { parseShellWords } from "./aedis.js";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

/**
 * Ptah adapter — driver for the Ptah lab runner agent.
 *
 * NOTE — protocol shape:
 *   Ptah currently ships as a long-running HTTP/WS service (default
 *   port 18810), not as a verb-style CLI. This adapter is wired with
 *   the same `<bin> submit <prompt>` shape we use for Aedis so that
 *   the moment Ptah ships a CLI (or an operator drops in a thin
 *   wrapper that maps `submit <prompt>` to `POST /api/tasks`), the
 *   adapter will work without code changes.
 *
 *   For the wrapper recipe see `docs/ADAPTERS.md` (Ptah section).
 *   Without a CLI on PATH, preflight will fail truthfully with
 *   `failureType: "adapter_setup_failed"` and the operator gets
 *   guidance — never a misclassified agent failure.
 *
 * Resolution order for the launch command (highest priority first):
 *   1. RunOptions.extra.command + .args  — programmatic override (tests)
 *   2. PTAH_BIN environment var          — operator override; may include args
 *      e.g. PTAH_BIN="node /path/to/ptah/dist/cli.js"
 *           PTAH_BIN=/usr/local/bin/ptah-cli
 *   3. literal "ptah"                    — assumes binary on PATH
 *
 * The wrapper does not fabricate model or cost identity. Until Ptah's
 * server reports those, the adapter says "unknown" / "not reported"
 * honestly. eventStructure stays "unstructured" until a future
 * adapter version reads `/api/sessions/<id>/events`.
 */
export function createPtahAdapter(): AgentAdapter {
  const inner = createGenericCliAdapter();

  return {
    ...inner,
    id: "ptah",
    version: "0.1.0",
    name: "Ptah",
    description:
      "Ptah agent driver. Dispatches prompts via `<ptah> submit <prompt>`. " +
      "Override with PTAH_BIN env (may include args, e.g. \"node /path/to/cli.js\") " +
      "or extra.command. Ptah currently ships as a service; see docs/ADAPTERS.md " +
      "for the wrapper recipe that bridges submit→POST /api/tasks.",
    capabilities: { ...inner.capabilities, fileEditing: true, toolUse: true },
    truth: {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    },
    protocol: {
      name: "ptah-cli",
      submitCommand: "<ptah> submit <prompt>",
      notes: [
        "Prompts are dispatched as a single argv element — no shell interpolation.",
        "PTAH_BIN may include args (e.g. \"node /path/to/cli.js\"); they are placed before `submit`.",
        "Health probe verifies the binary launches AND that `submit` appears in the CLI's commands list.",
        "Ptah ships as a service today; until a real Ptah CLI exists, point PTAH_BIN at a wrapper script (see docs/ADAPTERS.md).",
      ],
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const launch = resolvePtahLaunch(opts);
      const callerExtraArgs = (opts.extra as { args?: string[] } | undefined)?.args;
      const subcommandArgs = callerExtraArgs ?? ["submit"];
      const merged: RunOptions = {
        ...opts,
        extra: {
          provider: "ptah",
          location: opts.location ?? "unknown",
          ...(opts.extra ?? {}),
          command: launch.command,
          args: [...launch.args, ...subcommandArgs],
        },
      };
      return inner.startSession(merged);
    },

    async health() {
      const launch = resolvePtahLaunch({});
      const checks: string[] = [];

      // 1. Binary is on PATH (or absolute and executable).
      const which = spawnSync("sh", ["-c", `command -v -- ${shellQuote(launch.command)}`], {
        encoding: "utf8",
      });
      if (which.status !== 0 || !which.stdout.trim()) {
        return {
          ok: false,
          reason:
            `Ptah adapter could not launch: command not found "${launch.command}". ` +
            `Set PTAH_BIN to the absolute path of your ptah CLI ` +
            `(e.g. PTAH_BIN=/usr/local/bin/ptah) or include a runner with args ` +
            `(e.g. PTAH_BIN="node /path/to/ptah/dist/cli.js"). ` +
            `Ptah currently ships as a service; if you don't yet have a CLI, ` +
            `point PTAH_BIN at a thin wrapper that maps submit→POST /api/tasks ` +
            `(see docs/ADAPTERS.md, "Ptah wrapper recipe").`,
        };
      }
      checks.push(`binary resolved to ${which.stdout.trim()}`);

      // 2. Verify the CLI exposes the `submit` subcommand by reading its
      //    no-args usage line. Identical mechanism to the Aedis adapter.
      const probe = spawnSync(launch.command, [...launch.args], {
        encoding: "utf8",
        timeout: 5_000,
      });
      const probeText = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
      const commandsLine = probeText.match(/Commands?:\s*([^\n]+)/i);
      if (!commandsLine) {
        return {
          ok: false,
          reason:
            `Ptah adapter could not detect the CLI command list — the binary ` +
            `at "${launch.command}" did not print a "Commands: …" usage line. ` +
            `This likely means the binary is not the Ptah CLI (Ptah currently ` +
            `ships as a service); check PTAH_BIN or use a wrapper script that ` +
            `prints a Commands list including \`submit\`.`,
        };
      }
      const verbs = commandsLine[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!verbs.includes("submit")) {
        return {
          ok: false,
          reason:
            `Ptah CLI at "${launch.command}" does not expose a \`submit\` ` +
            `command (advertised: ${verbs.join(", ")}). The adapter will not ` +
            `send raw prompts as top-level CLI commands. If your Ptah build ` +
            `uses a different verb, pass it explicitly via extra.args=["<verb>"].`,
        };
      }
      checks.push(`submit command present (verbs: ${verbs.join(", ")})`);

      // 3. Probe the Ptah SERVER via `<bin> health` if the CLI implements
      //    it. Failure is non-fatal — submit may still work.
      if (verbs.includes("health")) {
        const healthProbe = spawnSync(launch.command, [...launch.args, "health"], {
          encoding: "utf8",
          timeout: 5_000,
        });
        if (healthProbe.status === 0) {
          const firstLine = (healthProbe.stdout ?? "").split("\n")[0]?.trim();
          checks.push(`server health: ${firstLine || "ok"}`);
        } else {
          const why =
            (healthProbe.stderr ?? "").trim().slice(0, 200) ||
            (healthProbe.stdout ?? "").trim().slice(0, 200) ||
            "(no output)";
          checks.push(`server health probe non-zero — ${why}`);
        }
      } else {
        checks.push("server health probe skipped (no `health` verb in CLI)");
      }

      return {
        ok: true,
        reason: checks.join("; "),
      };
    },
  };
}

/** Result of resolving the Ptah launch line. Mirror of AedisLaunch. */
export interface PtahLaunch {
  command: string;
  args: string[];
  source: "extra.command" | "PTAH_BIN" | "default";
}

/**
 * Resolve the Ptah launch line. Identical parser/precedence to the Aedis
 * resolver — only the env-var name and default differ. Reuses
 * `parseShellWords` from the Aedis adapter so quote / escape semantics
 * match exactly.
 */
export function resolvePtahLaunch(opts: { extra?: unknown }): PtahLaunch {
  const extra = (opts.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.command === "string" && extra.command) {
    const args = Array.isArray(extra.args)
      ? (extra.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    return { command: extra.command, args, source: "extra.command" };
  }
  const bin = process.env.PTAH_BIN;
  if (typeof bin === "string" && bin.trim().length > 0) {
    const tokens = parseShellWords(bin.trim());
    if (tokens.length > 0) {
      return {
        command: tokens[0],
        args: tokens.slice(1),
        source: "PTAH_BIN",
      };
    }
  }
  return { command: "ptah", args: [], source: "default" };
}

/** Quote a token for `sh -c "command -v -- <token>"`. */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
