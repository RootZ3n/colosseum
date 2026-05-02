# Architecture

This document describes how Colosseum is put together and how a trial flows from
"start" to "receipts on disk." The goal is for any reader — engineering, security,
product — to understand the system in one sitting.

## The five layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                              UI / CLI / API                         │
│                  (start trials, watch the arena floor)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  TrialOptions
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              Runner                                 │
│  fixture-manager · artifact-collector · trial-runner · velum guard  │
└──────────┬───────────────┬──────────────────────────┬───────────────┘
           │               │                          │
           ▼               ▼                          ▼
   ┌─────────────┐  ┌──────────────┐         ┌──────────────┐
   │  Adapters   │  │  Test Packs  │         │   Receipts   │
   │ (the agent) │  │ (the trials) │         │ (the record) │
   └─────────────┘  └──────────────┘         └──────────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │   Filesystem    │
                                          │ colosseum-state │
                                          └─────────────────┘
```

| Layer        | Responsibility                                                    |
|--------------|-------------------------------------------------------------------|
| **Adapters** | Translate an agent (Aedis, OpenClaw, Hermes, Claude Code, generic CLI…) into the `AgentAdapter` contract. Adapters **never** grade. |
| **Test Packs** | Provide individual `TestSpec`s — a prompt, optional fixture setup, and an `assert` that decides pass/fail and emits evidence. |
| **Runner** | Orchestrates a trial: per-test sandboxed workspace → adapter → assertion → Velum scan → receipt. |
| **Velum** | Pattern-based safety guard. Scans prompts and outputs. Records findings as evidence; never hides results. Can elevate `pass → fail` on critical findings. |
| **Scoring & Receipts** | Aggregate verdicts into a weighted trust score; persist a JSON + Markdown receipt per test and a summary per trial. |

## Data flow of a single trial

1. **Caller** (UI / CLI / API) supplies `{ adapter, packs, baseRunOptions }`.
2. **Runner** mints a `trialId` and ensures the state directory layout exists.
3. For each test in each pack:
   1. **FixtureManager** creates a fresh, empty per-test workspace under
      `colosseum-state/fixtures/<trialId>/<testId>-<rand>/`. The host repo is
      *never* the working directory.
   2. The test's optional `setup(ctx)` seeds files in the workspace.
   3. **Velum** scans the prompt before it leaves Colosseum.
   4. The adapter `startSession({ workspace, … })` and `sendPrompt(handle, prompt)`
      executes the agent and returns events, stdout/stderr, model info, cost,
      and artifacts.
   5. **ArtifactCollector** walks the workspace and produces the receipt's
      artifact list (capped at 500 entries, 256-byte previews).
   6. **Velum** scans the agent's output. If a `fail-test`-class finding
      surfaces, the runner overrides the test verdict from `pass → fail` and
      records the override in `reasons[]`.
   7. The test's `assert(ctx, run)` returns a `TestResult` (verdict, score,
      reasons, evidence).
   8. **ReceiptStore** writes both the JSON and Markdown receipt to
      `colosseum-state/receipts/<trialId>/<testId>.{json,md}`.
4. **Scoring.aggregate** rolls all per-test results into a weighted trust score.
5. **TrialStore** writes the summary to `colosseum-state/trials/<trialId>.json`.

The runner emits a typed `TrialEvent` stream with structured phases such as
`starting`, `test_started`, `adapter_event`, `receipt_written`, `scoring`, and
`complete`. Adapter `streamEvents()` is consumed concurrently with
`sendPrompt()` when the adapter supports it. Otherwise the stream is marked
`buffered` and contains only real runner lifecycle events plus post-hoc adapter
events from `AgentRunResult.events`.

The API forwards live events as SSE at `GET /api/trials/:trialId/events`.
Completed trials replay from `colosseum-state/trial-events/<trialId>.json`, so
refreshing the UI does not lose the Arena Floor timeline.

## State layout

```
colosseum-state/
├── trials/
│   └── <trialId>.json                # one TrialSummary per trial
├── trial-events/
│   └── <trialId>.json                # redacted live/replay TrialEvent timeline
├── receipts/
│   └── <trialId>/
│       ├── <testId>.json             # full machine-readable receipt
│       └── <testId>.md               # human-readable summary
├── fixtures/
│   └── <trialId>/
│       └── <testId>-<rand>/...       # per-test workspaces (evidence)
├── artifacts/                        # reserved for external artifact dumps
├── agents/                           # reserved for adapter configs
└── reports/                          # reserved for batch reports
```

All paths are relative to `process.cwd()` by default and configurable through
`--state` (CLI) or `COLOSSEUM_STATE` (server / API).

## Component map

```
src/
├── types.ts                # shared cross-cutting types
├── adapters/
│   ├── types.ts            # AgentAdapter contract
│   ├── registry.ts         # static factory map (5 adapters today)
│   ├── mock.ts             # deterministic adapter used by self-tests
│   ├── generic-cli.ts      # spawns any CLI; admits unknown model/cost
│   ├── aedis.ts            # wraps `aedis` CLI by default
│   ├── openclaw.ts         # wraps `openclaw` CLI by default
│   └── hermes.ts           # wraps `hermes` CLI; defaults to local
├── packs/
│   ├── types.ts            # TestSpec / TestPack / TestResult
│   ├── registry.ts         # static map of pack-id → pack
│   ├── truthfulness/index.ts
│   ├── repo-editing/index.ts
│   ├── safety/index.ts
│   ├── stamina/index.ts
│   └── local-model/index.ts
├── velum/
│   ├── guard.ts            # rules + scan() + combine()
│   └── redaction.ts        # secret-shaped value finder + redactor
├── runner/
│   ├── trial-runner.ts     # orchestration
│   ├── fixture-manager.ts  # per-test workspace lifecycle
│   └── artifact-collector.ts
├── scoring/
│   ├── score.ts            # weighted aggregation
│   └── verdict.ts          # severity-aware roll-up
├── receipts/
│   ├── receipt.ts          # JSON shape + Markdown renderer
│   └── receipt-store.ts    # filesystem persistence
├── storage/index.ts        # TrialStore + state layout helpers
├── api/
│   ├── server.ts           # express app, mounts routes + UI
│   └── routes/             # agents, packs, trials, receipts
├── cli/index.ts            # commander entry point
└── ui/                     # Vite + React arena
    ├── App.tsx
    ├── pages/              # Dashboard, NewTrial, Trials, TrialResults,
    │                       # ReceiptDetail, Agents, TestPacks
    └── components/         # ArenaTimeline, JudgesVerdict, ChampionBoard,
                            # VerdictPill, ScoreBar, LaurelMark
```

## Design principles

1. **Adapters cannot grade.** They translate. The grader is the test pack and
   the runner. This is what makes the score independent of the agent under test.
2. **Velum records, never hides.** Velum redacts secrets in *stored bytes*, but
   the *finding* is preserved on the receipt — kind, severity, decision, reason.
   You always see that something happened.
3. **No fake precision.** When something is unknown ("model? cost?"), Colosseum
   says so on the receipt and on the UI. Cost efficiency is held neutral when
   nothing is reported — never assumed zero.
4. **No host-repo mutation.** Every test gets a fresh workspace under
   `colosseum-state/fixtures/`. The runner verifies this; tests/runner.test.ts
   asserts the host cwd is unchanged across a run.
5. **Severity is real.** A high-severity fail produces an overall **FAIL**, even
   if the pass rate is high. Critical safety failures cannot be drowned by
   easy passes.
6. **Receipts are first-class.** Every UI detail page and every CLI report is
   ultimately a view over the receipt JSON. No score appears without a reason.

## Extension points

- **New adapter** → see [`ADAPTERS.md`](ADAPTERS.md). Implement `AgentAdapter`,
  register in `src/adapters/registry.ts`.
- **New pack / test** → see [`TEST-PACKS.md`](TEST-PACKS.md). Drop a `TestSpec`
  in a pack folder; add the pack to `src/packs/registry.ts`.
- **New Velum rule** → add to the `INJECTION_RULES`, `DESTRUCTIVE_RULES`, or
  secret-pattern list in `src/velum/`. Each rule needs a stable id, a regex,
  a severity, a decision, and a one-sentence reason.
- **New scoring weight** → tune the `WEIGHTS` map in `src/scoring/score.ts`
  (safety stays highest by policy).
