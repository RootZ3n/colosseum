# Adapters

An **adapter** is the only thing Colosseum ever knows about an agent. Every
agent — Aedis, OpenClaw, Hermes, Claude Code, Codex, your in-house CLI — is
reachable through one small interface.

Adapters translate. They do not grade.

## The contract

The full type is `AgentAdapter` in `src/adapters/types.ts`. Required surface:

```ts
interface AgentAdapter {
  readonly id: string;                // stable identifier — used everywhere
  readonly name: string;              // human display name
  readonly description: string;
  readonly capabilities: Capabilities;

  health(): Promise<{ ok: boolean; reason?: string }>;
  startSession(opts: RunOptions): Promise<SessionHandle>;
  sendPrompt(handle: SessionHandle, prompt: string): Promise<AgentRunResult>;
  streamEvents?(handle: SessionHandle): AsyncIterable<AgentEvent>;
  stop(handle: SessionHandle): Promise<void>;
  collectArtifacts(handle: SessionHandle): Promise<AgentArtifact[]>;
  getModelInfo(handle: SessionHandle): Promise<ModelInfo>;
  getCostInfo(handle: SessionHandle): Promise<CostInfo>;
}
```

`Capabilities` declares booleans like `streaming`, `toolUse`, `fileEditing`,
`shellExecution`, `modelSelection`, `reportsCost`, `reportsTokens`. The UI uses
these to surface what an agent can and cannot do.

## The honesty rules

These are not suggestions:

1. **Model identity must be truthful.** Set `ModelInfo.model`, `provider`, and
   `location` to what the agent actually uses. If you don't know, say
   `"unknown"`. Never invent.
2. **Cost must be truthful.** If your adapter cannot introspect cost, set
   `costInfo.reported = false` and put a one-sentence note in `costInfo.note`
   ("generic CLI adapter does not introspect cost/tokens"). Never fabricate
   numbers. Colosseum's scoring layer holds cost efficiency neutral when
   nothing is reported — it does *not* assume zero.
3. **Adapters do not grade.** Don't read other adapters' state, don't modify
   receipts, don't reach into scoring. Adapters only translate from the agent's
   native API to `AgentEvent` / `AgentRunResult`.
4. **Stay inside the workspace.** `RunOptions.workspace` is the only directory
   the agent should write to. The runner's `FixtureManager` creates a fresh
   one per test; abuse of this trust will be detected by the repo-editing pack.

## Built-in adapters

| Id            | Wraps                                         | Default location | Notes                                                         |
|---------------|-----------------------------------------------|------------------|---------------------------------------------------------------|
| `mock`        | Nothing — in-process deterministic agent      | `local`          | Used by Colosseum's self-tests. Reads simple prompt keywords. |
| `generic-cli` | Any CLI passed as `extra.command`             | `unknown`        | Truthfully marks model/cost as `unknown` / `not reported`.    |
| `aedis`       | `aedis submit <prompt>` (or `$AEDIS_BIN` / `extra.command`) | `unknown` | Health verifies the binary and `submit` protocol before tests run. |
| `betterclaw`  | `betterclaw agent --local --session-id <id> --message <prompt>` | `unknown` | Uses isolated per-test state; override with `$BETTERCLAW_BIN` or `extra.command`. |
| `openclaw`    | `openclaw agent --local --session-id <id> --message <prompt>` | `unknown` | Uses isolated per-test state; override with `$OPENCLAW_BIN` or `extra.command`. |
| `hermes`      | `hermes chat …` (overridable)                 | `local`          | Local-first by default.                                        |
| `squidley`    | `POST $SQUIDLEY_URL/api/chat`                 | `local`          | Public Squidley HTTP adapter. Defaults to `http://127.0.0.1:3000`. |
| `ptah`        | `ptah submit <prompt>` (or `$PTAH_BIN` / `extra.command`) | `unknown` | Lab-only adapter. Set `COLOSSEUM_LAB_ADAPTERS=ptah` to show it in CLI/UI lists. Ptah ships as a service today; adapter expects a CLI wrapper. |
| `squidley-v2` | `POST $SQUIDLEY_V2_URL/chat`                  | `local`          | Lab-only Squidley-v2 HTTP adapter. Defaults to `http://127.0.0.1:18791`. |

Future targets: Claude Code, Codex, OpenCode. Each fits the same contract; pass
`extra.command` and `extra.args` if you only need to drive a CLI.

### Lab-only adapters

`getAdapter("ptah")` and `getAdapter("squidley-v2")` still work for internal
tests and local development, but lab-only adapters are hidden from public
`list agents` output and the UI unless explicitly enabled:

```bash
COLOSSEUM_LAB_ADAPTERS=ptah,squidley-v2 npm run dev
COLOSSEUM_LAB_ADAPTERS=squidley-v2 npm run cli -- list agents
```

This keeps unreleased lab agents out of the public product surface without
removing their adapter tests.

## Adding an adapter

A complete walkthrough.

### 1. Create the file

`src/adapters/my-agent.ts`:

```ts
import { nanoid } from "nanoid";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

export function createMyAgentAdapter(): AgentAdapter {
  const sessions = new Map<string, { workspace: string }>();

  return {
    id: "my-agent",
    name: "My Agent",
    description: "What this agent is.",
    capabilities: {
      streaming: false,
      toolUse: true,
      fileEditing: true,
      shellExecution: false,
      modelSelection: true,
      reportsCost: true,
      reportsTokens: true,
    },

    async health() {
      return { ok: true };
    },

    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const sessionId = `mine-${nanoid(8)}`;
      sessions.set(sessionId, { workspace: opts.workspace });
      return {
        sessionId,
        workspace: opts.workspace,
        modelInfo: {
          model: opts.model ?? "my-agent-default",
          provider: "my-org",
          location: opts.location ?? "cloud",
          adapterVersion: "0.1.0",
        },
      };
    },

    async sendPrompt(handle, prompt) {
      // call your real agent here, then translate the output:
      const events = [{ ts: Date.now(), kind: "thought", text: "ran" }];
      return {
        events,
        artifacts: [],
        exitCode: 0,
        modelInfo: handle.modelInfo,
        costInfo: { reported: true, totalTokens: 42, estimatedCostUsd: 0.0001 },
        durationMs: 1,
        stdout: "",
        stderr: "",
        finalAnswer: "ok",
      };
    },

    async stop() {},
    async collectArtifacts() { return []; },
    async getModelInfo(handle) { return handle.modelInfo; },
    async getCostInfo() { return { reported: true, totalTokens: 42 }; },
  };
}
```

### 2. Register it

In `src/adapters/registry.ts`:

```ts
import { createMyAgentAdapter } from "./my-agent.js";

const factories = {
  mock: createMockAdapter,
  // …
  "my-agent": createMyAgentAdapter,
};
```

### 3. Use it

```bash
npm run cli -- run --agent my-agent --pack truthfulness safety
```

The adapter immediately appears in the **Agents** page of the UI and the
**New Trial** dropdown.

## The "Generic CLI" shortcut

For adapters that only need to shell out, you can wrap `createGenericCliAdapter`
and override defaults — see `src/adapters/aedis.ts` for the pattern:

```ts
const inner = createGenericCliAdapter();
return {
  ...inner,
  id: "my-agent",
  name: "My Agent",
  async startSession(opts) {
    return inner.startSession({
      ...opts,
      extra: {
        command: "my-agent",
        args: ["--prompt"],
        provider: "my-org",
        location: opts.location ?? "cloud",
        ...(opts.extra ?? {}),
      },
    });
  },
};
```

## Testing your adapter

Add a vitest entry under `tests/`. The contract test in `tests/adapters.test.ts`
already verifies every registered adapter exposes the surface — your adapter
will be checked automatically once it's in the registry.

For functional checks, run it against the safety and truthfulness packs:

```bash
npm run cli -- run --agent my-agent --pack truthfulness safety repo-editing
```

If the trust score is high but the safety pack failed, look at the receipts —
that's the whole point.

## Streaming status (v0.1)

`AgentAdapter.streamEvents()` is now consumed concurrently with `sendPrompt()`.
Adapters that implement a real async event source can surface live `thought`,
`tool_call`, `stdout`, `stderr`, `final`, and `error` events while a test is
still running. The runner redacts streamed text before it reaches the API/UI.

Adapters that do not provide a live stream still work. Colosseum emits runner
lifecycle events (`test_started`, `receipt_written`, `scoring`, `complete`) and
marks the timeline as `buffered` with this operator-facing message:

> This adapter does not provide live step events; showing trial status and receipt timeline.

Do not fake fine-grained steps. If an adapter only has post-hoc events, return
them in `AgentRunResult.events`; the runner will replay them as buffered events
without changing scoring.

## Stamina observability (CLI adapters have limits)

The `stamina` pack — specifically `stamina.multi-step` — looks for evidence
that the agent took staged work before answering: typed events on the run's
event stream (`thought`, `tool_call`, `plan`, `step`), or text-level cues like
numbered lists, bullets, and "first / then / finally" sequence words.

**CLI-wrapping adapters cannot reliably surface this evidence.** Their
`truth.eventStructure` is `"unstructured"`: all the runner sees is whatever
the agent printed to stdout. If the agent worked in steps internally and
emitted only a final answer, the test has no way to tell.

`stamina.multi-step` is observability-aware about this. When the adapter
declares `eventStructure: "unstructured"` and no step indicators are visible,
the test returns **warn** with a reason that explicitly calls out the
adapter limitation rather than penalizing the agent. Score is `0.6`
(slightly higher than the `0.5` partial used when a structured adapter
*could* have surfaced events but didn't).

The right fix is not to fake events. Future work — tracked as a TODO in
`src/packs/stamina/index.ts` — is to integrate the real Aedis status / events
API: when an Aedis-specific adapter surfaces `step`, `tool_call`, and `plan`
events from `/api/sessions/<id>/events`, it can flip its truth contract to
`structured` and the test will see real evidence.

Until then, treat `stamina.multi-step` warns from CLI adapters as expected.
The trust score absorbs them: warn contributes a partial value to the
category average and is visible as the gap between pass-rate and category
score (see `docs/SCORING.md`).

Live delivery is available through the runner's `onEvent` callback and the API
SSE endpoint `GET /api/trials/:trialId/events`. Completed trials are replayed
from `colosseum-state/trial-events/<trialId>.json`.

## Ptah wrapper recipe

Ptah currently ships as a long-running HTTP/WS service (default port
**18810**), not as a verb-style CLI. The Ptah adapter is wired with the
same `<bin> submit <prompt>` shape we use for Aedis so it'll work the
moment a real Ptah CLI lands. Until then, point `PTAH_BIN` at a thin
wrapper that satisfies two contracts at once: Colosseum's adapter shape
*and* a real submit→poll→answer round-trip against the Ptah HTTP API.

### Why the wrapper has to wait

A naive wrapper that just POSTs `/api/tasks` and prints the 202 response
is what Colosseum used to ship, and the trial results were a lie:
Colosseum saw a 14 ms duration, no final answer, and Ptah's truthfulness
score reflected the wrapper, not the agent. The wrapper below polls
`GET /api/tasks/:id` until Ptah writes a receipt and prints the
synthesized summary, so Colosseum measures Ptah's actual answer.

### What the wrapper does

1. **`ptah` (no args)** — prints `Commands: submit, status, health` so
   the adapter's CLI-shape probe accepts it.
2. **`ptah health`** — `GET /api/health`. First line is `status: <ok|…>`
   for the adapter's first-line scrape; full JSON follows.
3. **`ptah status`** — `GET /api/active-task` for human inspection.
4. **`ptah submit "<prompt>"`** —
   - `POST /api/tasks` with body `{"input": "<prompt>", "repo": null}`
     (Ptah uses `input`, not `prompt`).
   - extract `taskId` from the 202 response.
   - poll `GET /api/tasks/:id` every `PTAH_WRAPPER_POLL_INTERVAL`
     seconds (default 1).
   - when the response has `kind: "receipt"`, print the receipt's
     `taskId`, `status`, `result.summary`, confidence, failure class,
     failure reasons, and per-step breakdown — enough text for
     truthfulness, safety, and stamina-multi-step packs to evaluate.
   - on timeout, attempt `POST /api/tasks/:id/cancel` (best-effort) so
     the runaway doesn't hold Ptah's queue, then exit non-zero.

### Configuration

| Env var                          | Default                          | Effect |
|----------------------------------|----------------------------------|--------|
| `PTAH_URL`                       | `http://127.0.0.1:18810`         | Ptah HTTP base URL. |
| `PTAH_API_TOKEN`                 | unset                            | When set, sent as `Authorization: Bearer …`. |
| `PTAH_WRAPPER_TIMEOUT_SECONDS`   | `120`                            | Hard cap on submit→receipt round-trip. |
| `PTAH_WRAPPER_POLL_INTERVAL`     | `1`                              | Seconds between polls. |

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | Ptah returned a receipt — `success`, `partial`, `escalated`, or `failed`. The wrapper does not editorialize; receipt status is printed and Colosseum scores the actual answer. |
| 2    | Misuse (`submit` with no prompt, unknown verb). |
| 124  | Wrapper timeout exceeded before a receipt arrived. The task is best-effort-cancelled before exit. |
| 1    | Network error, malformed JSON, or missing `curl`/`jq`. |

### The script

The full script lives at `scripts/ptah-wrapper.sh` in this repo. Install
it with a symlink so updates flow through automatically:

```bash
ln -sf "$(pwd)/scripts/ptah-wrapper.sh" ~/bin/ptah
export PTAH_BIN=~/bin/ptah

# Sanity check against your running Ptah service.
ptah health        # status: ok …
ptah submit "say hi in one short sentence"

# Then run the packs.
npm run cli -- run --agent ptah --pack truthfulness safety stamina
```

### Wrapper smoke test

`tests/ptah-wrapper.test.ts` boots a fake Ptah HTTP server inside vitest
and exercises the wrapper end-to-end: submit returns a `taskId`, the
wrapper polls until the fake flips `kind` to `receipt`, the printed
output contains the receipt summary, and the timeout path exits 124
after best-effort cancel. Run it with:

```bash
npx vitest run tests/ptah-wrapper.test.ts
```

When Ptah ships a real CLI, this wrapper goes away and operators just
set `PTAH_BIN="node /path/to/ptah/dist/cli.js"` (or whatever shape ships).

## Smoke test recipe (Aedis)

For a quick end-to-end smoke without installing the real Aedis binary, point
`AEDIS_BIN` at any local executable. The adapter spawns it as a real
subprocess, captures stdout/stderr/events, and produces real receipts.

```bash
AEDIS_BIN=/bin/echo npm run cli -- run --agent aedis --pack truthfulness
```

Expected outcome with `/bin/echo` as the agent: `truth.final-answer` PASSes
(echo produces output), the file-edit and tool-failure tests FAIL (echo cannot
edit files). The trial verdict is **FAIL** — exactly what an honest harness
should report when the "agent" is incapable. The point of the smoke is that
every step of the pipeline (binary resolution, subprocess spawn, event capture,
diff computation, receipt write, scoring) executes end-to-end without the mock.
