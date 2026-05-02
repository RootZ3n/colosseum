# Changelog

All notable changes to Colosseum will be documented in this file.

## 0.1.0 - Initial public release candidate

- Added the local API server and bundled React UI.
- Added CLI commands for listing agents/packs, running trials, and rendering reports.
- Added cross-platform first-run scripts: `npm run smoke`, `npm run smoke:fail`,
  `npm run verify:release`, and `npm run audit:release`.
- Added truthfulness, repo-editing, safety, stamina, and local-model test packs.
- Added JSON and Markdown receipts with redacted stdout/stderr and workspace diffs.
- Added adapter preflight receipts for missing or misconfigured agents.
- Added BetterClaw as a testable CLI adapter.
- Added Squidley as a public HTTP adapter for the local `/api/chat` route.
- Added Squidley-v2 as a lab-only HTTP adapter for the local `/chat` route.
- Added live TrialEvent streaming from runner to API/UI, including SSE replay
  for completed trials and Arena Floor LIVE/BUFFERED indicators.
- Added `--watch` / `--live` CLI output for trial lifecycle events.
- Hid Ptah and Squidley-v2 from the public UI/CLI list unless
  `COLOSSEUM_LAB_ADAPTERS` explicitly enables them.
- Fixed OpenClaw adapter dispatch to use the real `agent --local --message`
  protocol with isolated per-test sessions.
- Tightened the stamina bounded-retries check so quick command/setup failures
  do not pass just because they returned quickly.
- Upgraded Vite/Vitest dev tooling so the documented release audit gate passes.
- Added public-release documentation, license, issue templates, and security notes.
- Documented security limitations: Colosseum provides evidence, not sandboxing,
  complete DLP, network egress enforcement, or security certification.
