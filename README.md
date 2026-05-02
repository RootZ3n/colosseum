# Colosseum

> **Stop guessing if your agent works. Put it in the arena.**

Colosseum is a local-first **agent proving ground**. It runs AI agents through
repeatable trials, writes JSON + Markdown receipts, and makes unknowns explicit
instead of turning them into green checkmarks.

Agents enter the arena and are judged on five core behaviors:

| Pillar          | What it measures                                                      |
|-----------------|-----------------------------------------------------------------------|
| **Truthfulness** | Does it report what actually happened, or invent success?            |
| **Safety**       | Does it resist injection, refuse destructive actions, redact secrets? |
| **Reliability**  | Does it edit the right files, contain its blast radius, leave the repo clean? |
| **Stamina**      | Does it complete multi-step work, bound its retries, and stop cleanly? |
| **Evidence**     | Does every verdict come with a receipt you can read?                  |

Colosseum is **standalone**. It is not a feature of any other product. Visually
it stands on its own — marble, bronze, dark stone, torchlight.

---

## Why this exists

Most agent demos are pass/fail vibes. A green checkmark in a tweet. A short clip
where the agent “did the thing.” And then a year of production where you slowly
learn the agent silently fails, lies about success, leaks secrets, or burns
through tokens on the wrong model.

Colosseum exists so you can stop guessing. Every trial produces a **receipt** —
a JSON + Markdown record of the prompt, the model used, the cost (or honest
"not reported"), the agent's output, the test verdict, the reasons, the
artifacts produced, and any safety findings. You can audit it. You can diff
two runs. You can hand it to your security team.

---

## The promise

- **Transparency** — every verdict comes with reasons. There are no opaque scores.
- **Receipts** — every test produces JSON + a human-readable Markdown summary.
- **Model & provider agnostic** — local or cloud, Anthropic or Ollama or LM Studio
  or your own. Adapters declare what they are. Colosseum never lies about it.
- **Local + cloud evidence** — local model packs check adapter-reported
  local/cloud identity and cost signals. Colosseum records that evidence, but
  does not enforce network egress isolation by itself.
- **Token / cost aware** — when adapters report tokens and cost, they go on the
  receipt. When they can't, the receipt says **"not reported"**. We never invent
  numbers.
- **Velum-style safety** — a pattern-based guard layer scans prompts and outputs
  for injection probes, destructive commands, and secret leakage. Velum *records
  evidence*; it never hides results.
- **Adapter-based** — every agent (Aedis, BetterClaw, OpenClaw, Squidley,
  Hermes, Claude Code, Codex, a generic CLI, your own) is reachable through one
  small `AgentAdapter` contract. Adapters cannot reach into scoring; they only
  translate.
- **Live Arena Floor** — trials emit a redacted `TrialEvent` stream over SSE so
  the UI can show real test lifecycle and adapter events while the run is active.
- **Truthful scoring** — no fake precision, no rounded-up averages. Safety
  weighs heaviest. "Unknown" stays "unknown".

---

## What the arena looks like

The Colosseum UI is intentionally **not** the look of any other product. Inspired
by the Roman Colosseum, the visual language is:

- **Dark stone** background with two warm radial torch glows in the upper corners
- **Marble cards** for verdict surfaces, with subtle veining
- **Bronze and gold** accents for borders, buttons, and the laurel mark
- **Crimson banners** for failed verdicts, **laurel green** for wins
- **Cinzel** for display type, **Inter** for body, **JetBrains Mono** for telemetry

Pages: **Arena** (dashboard + Champion Board), **New Trial**, **Trials**,
**Trial Results** (Judge's Verdict marble card), **Receipt Detail** (the
"Receipts Vault"), **Agents**, **Test Packs**.

---

## Requirements

- Git
- Node.js **18.17 or newer**
- npm (the version bundled with your Node install is fine)

Colosseum v0.1.0 is a **source install** release: clone the repo and run npm
commands from the checkout. It is not documented as a global `npm install -g`
or `npx` package yet.

## Quickstart — Linux, macOS, WSL2

```bash
git clone https://github.com/RootZ3n/colosseum.git
cd colosseum
npm ci
npm run build
npm run smoke
```

## Quickstart — Windows PowerShell

```powershell
git clone https://github.com/RootZ3n/colosseum.git
cd colosseum
npm ci
npm run build
npm run smoke
```

The smoke test uses the built-in mock agent and does not need an external agent,
API key, local model, shell alias, or systemd service.

Expected passing smoke output:

```text
Running Colosseum passing smoke test (mock agent + stamina pack)...
State directory: ...

Trial trial-... — PASS
  pass=4  fail=0  total=4
  trust=100%

Passing smoke test succeeded.
```

## Start the local API/UI

After `npm run build`, start the single-process local server:

```bash
npm run start
# open http://127.0.0.1:18799
```

PowerShell uses the same command:

```powershell
npm run start
```

Dev mode (hot reload, two processes):

```bash
npm run dev
# api: http://127.0.0.1:18799
# ui:  http://127.0.0.1:5180   ← open this one in dev
```

For a full guide (dev / local / advanced Linux systemd / health endpoint / state
directory), see [`docs/RUNNING.md`](docs/RUNNING.md).

## Headless CLI

```bash
npm run cli -- list agents
npm run cli -- list packs
npm run cli -- run --agent mock --pack stamina --quiet
npm run cli -- report <trialId>
```

The beginner-friendly equivalent is:

```bash
npm run smoke
```

Some packs intentionally expose failures. For example, the mock agent is
designed to fail part of the truthfulness pack so you can inspect an honest
failure receipt:

```bash
npm run smoke:fail
```

`npm run smoke:fail` succeeds when Colosseum correctly reports `FAIL` and the
underlying trial exits `2`.

### Smoke against a real local agent

Everything above works out of the box. Aedis, BetterClaw, OpenClaw, Squidley,
Hermes, and `generic-cli` are external-agent paths and require the corresponding
local binary, service, credentials, or adapter configuration. Ptah and Squidley-v2
are lab-only in v0.1; set `COLOSSEUM_LAB_ADAPTERS=ptah,squidley-v2` to show them
in the UI/CLI adapter list for local development.

The Aedis adapter resolves its binary in this order: `extra.command` → `AEDIS_BIN`
env → literal `aedis` on PATH. Its health check verifies the binary exposes
`submit` before tests run, so point `AEDIS_BIN` at a real Aedis CLI or wrapper:

```bash
AEDIS_BIN=/usr/local/bin/aedis npm run cli -- run --agent aedis --pack truthfulness
```

For an arbitrary command-shaped agent that does not have a dedicated adapter yet,
use `generic-cli` with `extra.command` from the API or add a thin adapter wrapper.

Receipts land under `colosseum-state/receipts/<trialId>/` as paired `.json` +
`.md` files. Each one carries the prompt, the agent stdout/stderr (redacted),
the model/cost identity (truthful, including `unknown`), the assertion's
PASS/FAIL reason, the captured artifacts, and a unified-diff summary of the
agent-induced workspace changes.

State lives under `./colosseum-state/` (override with `--state` or
`COLOSSEUM_STATE`). Do not point `COLOSSEUM_STATE_ROOT` or `--state` at an
important directory; Colosseum may remove per-test fixture workspaces according
to the cleanup policy.

Release validation commands:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify:release
npm audit --audit-level=moderate --omit=optional
```

No JavaScript lint stack is configured in v0.1; typecheck and tests are the
current release gates. The audit command omits platform-specific optional
packages so npm's audit endpoint evaluates the installed cross-platform tree
consistently.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `EADDRINUSE :18799` | Another process is already using the default port. Stop it, or set `COLOSSEUM_PORT` before `npm run start` (`$env:COLOSSEUM_PORT=18899` in PowerShell, `COLOSSEUM_PORT=18899 npm run start` in POSIX shells). |
| `npm ci` or audit reports optional package/platform noise | Use the documented audit command: `npm audit --audit-level=moderate --omit=optional`. |
| PowerShell cannot find `npm` or `node` | Reopen PowerShell after installing Node, then check `node --version` and `npm --version`. |
| PowerShell blocks scripts | The npm commands above run Node scripts directly. If your environment blocks npm shims, use a normal PowerShell profile or WSL2. |
| Missing external agent binary | Start with `npm run smoke`; external adapters require their own binaries or services. Missing binaries produce an adapter setup `ERROR` receipt. |
| Where are receipts? | Trial summaries and receipts are written under `./colosseum-state/` by default. The smoke script uses a safe temporary state directory and prints it. |

---

## Repo structure

```
colosseum/
├── src/
│   ├── adapters/      # AgentAdapter contract and implementations
│   ├── runner/        # Trial orchestration, fixtures, artifact collection
│   ├── packs/         # Truthfulness, repo-editing, safety, stamina, local-model
│   ├── scoring/       # Weighted scoring + verdict roll-up
│   ├── receipts/      # JSON + Markdown receipts and the receipt store
│   ├── velum/         # Prompt-injection / secret guard
│   ├── cli/           # `colosseum` command-line entry
│   ├── ui/            # Vite + React arena UI
│   └── api/           # Express HTTP API
├── tests/             # Vitest suites
└── docs/
    ├── ARCHITECTURE.md   System design, data flow, state layout
    ├── ADAPTERS.md       Adapter contract + how to add one
    ├── TEST-PACKS.md     Pack catalogue + how to add a pack/test
    └── SCORING.md        Weights, verdicts, the "no fake precision" rule
```

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components and how a trial flows
- [`docs/ADAPTERS.md`](docs/ADAPTERS.md) — how to plug in an agent
- [`docs/TEST-PACKS.md`](docs/TEST-PACKS.md) — pack catalogue and authoring guide
- [`docs/SCORING.md`](docs/SCORING.md) — what every score actually means

---

## Security and Limitations

- The API binds to `127.0.0.1` by default. If you expose it with
  `COLOSSEUM_HOST=0.0.0.0`, put it behind your own access controls.
- CLI adapters can execute local commands. Treat adapter configuration as
  trusted operator input, especially `generic-cli`, `AEDIS_BIN`, and `PTAH_BIN`.
- Velum and redaction are regex/pattern based. They provide explainable evidence,
  not a complete data-loss-prevention system.
- Local/cloud model identity is adapter-reported unless you enforce network
  egress externally.

---

## Status

Colosseum v0.1 is an MVP. The core runner, adapters, packs, Velum, scoring,
receipts, CLI, API, and UI are present and tested. Adapter implementations for
Aedis, BetterClaw, OpenClaw, and Hermes wrap a default CLI. Squidley uses its
local HTTP API. Replace with richer SDK integrations as those stabilize.

> Stop guessing if your agent works. Put it in the arena.
