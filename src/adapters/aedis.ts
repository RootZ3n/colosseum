import { spawnSync } from "node:child_process";
import { createGenericCliAdapter } from "./generic-cli.js";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

/**
 * Aedis adapter — driver for the Aedis CLI.
 *
 * Aedis exposes a verb-style CLI:
 *
 *   aedis <command> [args]
 *   Commands: submit, status, metrics, sessions, workers, health, doctor, …
 *
 * Sending a raw prompt as the top-level command is not valid — Aedis answers
 * with `Unknown command: …` and lists the legal verbs. The adapter therefore
 * dispatches every test prompt through the **`submit`** subcommand:
 *
 *   <bin> [<runner-args>] submit <prompt>
 *
 * No shell interpolation; the prompt is always passed as a single argv
 * element so spaces, quotes, and shell metacharacters are safe.
 *
 * AEDIS_BIN resolution order (highest priority first):
 *   1. RunOptions.extra.command + .args  — programmatic override (tests)
 *   2. AEDIS_BIN environment var         — operator override; may include args
 *      e.g. AEDIS_BIN="node /path/to/cli.js"
 *   3. literal "aedis"                   — assumes binary on PATH
 *
 * The wrapper does not fabricate model or cost identity. If Aedis stops
 * reporting either, the adapter says "unknown" / "not reported" honestly.
 * Replace this file when a richer Aedis SDK lands.
 */
export function createAedisAdapter(): AgentAdapter {
  const inner = createGenericCliAdapter();

  return {
    ...inner,
    id: "aedis",
    version: "0.1.0",
    name: "Aedis",
    description:
      "Aedis agent driver. Dispatches prompts via `<aedis> submit <prompt>`. " +
      "Override the binary with AEDIS_BIN env (may include args) or extra.command.",
    capabilities: { ...inner.capabilities, fileEditing: true, toolUse: true },
    truth: {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    },
    protocol: {
      name: "aedis-cli",
      submitCommand: "<aedis> submit <prompt>",
      notes: [
        "Prompts are dispatched as a single argv element — no shell interpolation.",
        "AEDIS_BIN may include args (e.g. \"node /path/to/cli.js\"); they are placed before `submit`.",
        "Health probe verifies the binary launches AND that `submit` appears in the CLI's commands list.",
      ],
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const launch = resolveAedisLaunch(opts);
      const callerExtraArgs = (opts.extra as { args?: string[] } | undefined)?.args;
      // Default args put `submit` between any runner-args and the prompt.
      // Operator can override the subcommand by passing extra.args (e.g.
      // ["dispatch"] for a hypothetical future Aedis verb), but the prompt
      // is always the final argv element appended by generic-cli.
      const subcommandArgs = callerExtraArgs ?? ["submit"];
      const merged: RunOptions = {
        ...opts,
        extra: {
          provider: "aedis",
          location: opts.location ?? "unknown",
          ...(opts.extra ?? {}),
          command: launch.command,
          args: [...launch.args, ...subcommandArgs],
        },
      };
      return inner.startSession(merged);
    },

    async health() {
      const launch = resolveAedisLaunch({});
      const checks: string[] = [];

      // 1. Binary is on PATH (or absolute and executable).
      const which = spawnSync("sh", ["-c", `command -v -- ${shellQuote(launch.command)}`], {
        encoding: "utf8",
      });
      if (which.status !== 0 || !which.stdout.trim()) {
        return {
          ok: false,
          reason:
            `Aedis adapter could not launch: command not found "${launch.command}". ` +
            `Set AEDIS_BIN to the absolute path of your aedis CLI ` +
            `(e.g. AEDIS_BIN=/usr/local/bin/aedis) or include a runner with args ` +
            `(e.g. AEDIS_BIN="node /path/to/aedis/dist/cli/aedis.js"). ` +
            `If you have a local checkout, run \`npm run build\` in it first so the ` +
            `dist/cli/aedis.js entry exists.`,
        };
      }
      checks.push(`binary resolved to ${which.stdout.trim()}`);

      // 2. Verify the CLI exposes the `submit` subcommand.
      //    Running the binary with NO arguments prints the usage line:
      //      "Usage: aedis <command> [args]
      //       Commands: submit, status, metrics, sessions, workers, …"
      //    We accept any of stdout/stderr because some implementations
      //    write usage to stderr.
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
            `Aedis adapter could not detect the CLI command list — the binary ` +
            `at "${launch.command}" did not print a "Commands: …" usage line. ` +
            `This likely means the binary is not the Aedis CLI; double-check AEDIS_BIN.`,
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
            `Aedis CLI at "${launch.command}" does not expose a \`submit\` ` +
            `command (advertised: ${verbs.join(", ")}). The adapter will not ` +
            `send raw prompts as top-level CLI commands. If your Aedis build ` +
            `has renamed the verb, pass it explicitly via extra.args=["<verb>"].`,
        };
      }
      checks.push(`submit command present (verbs: ${verbs.join(", ")})`);

      // 3. Probe the Aedis SERVER via `<bin> health`. Failure here is
      //    NOT fatal for the preflight — submit may still work in some
      //    deployments — but we record it so the operator sees it.
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

      return {
        ok: true,
        reason: checks.join("; "),
      };
    },
  };
}

/** Result of resolving the Aedis launch line. */
export interface AedisLaunch {
  command: string;
  args: string[];
  source: "extra.command" | "AEDIS_BIN" | "default";
}

/**
 * Resolve the Aedis launch line — exported so tests and the runner can
 * inspect what the adapter would actually exec without paying the spawn cost.
 *
 * AEDIS_BIN parsing is intentionally simple shell-style:
 *   - whitespace-separated tokens
 *   - tokens may be quoted with single or double quotes to embed spaces
 *   - backslash-escapes a single space when not inside quotes
 *
 * This covers `node /path/to/cli.js`, `/usr/local/bin/aedis`,
 * `"npx tsx /path/to/aedis.ts"`. It does NOT support full shell features
 * like variable expansion or pipes — operators wanting those should put
 * the launcher in a wrapper script and point AEDIS_BIN at the wrapper.
 */
export function resolveAedisLaunch(opts: { extra?: unknown }): AedisLaunch {
  const extra = (opts.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.command === "string" && extra.command) {
    const args = Array.isArray(extra.args)
      ? (extra.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    return { command: extra.command, args, source: "extra.command" };
  }
  const bin = process.env.AEDIS_BIN;
  if (typeof bin === "string" && bin.trim().length > 0) {
    const tokens = parseShellWords(bin.trim());
    if (tokens.length > 0) {
      return {
        command: tokens[0],
        args: tokens.slice(1),
        source: "AEDIS_BIN",
      };
    }
  }
  return { command: "aedis", args: [], source: "default" };
}

/**
 * Parse a string into shell-style words. Honors single and double quotes,
 * backslash-escape outside quotes. Does NOT do variable expansion.
 */
export function parseShellWords(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else buf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else if (ch === "\\" && i + 1 < input.length) {
        buf += input[++i];
      } else buf += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      buf += input[++i];
    } else if (/\s/.test(ch)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/** Quote a token for `sh -c "command -v -- <token>"`. */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
