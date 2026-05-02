# Security and Limitations

Colosseum is a local-first harness. It helps produce evidence about agent
behavior, but it is not a sandbox, DLP product, or security certification.

## Local API Binding

The API binds to `127.0.0.1` by default. If you set `COLOSSEUM_HOST=0.0.0.0`,
put Colosseum behind your own authentication, authorization, and network access
controls.

## CLI Adapter Risk

Adapters such as `generic-cli`, `aedis`, and `ptah` can execute local commands
configured by the operator. Treat adapter configuration, including `AEDIS_BIN`,
`PTAH_BIN`, and `extra.command`, as trusted input.

## State Directory Safety

Colosseum stores trial receipts, summaries, and per-test workspaces under
`COLOSSEUM_STATE_ROOT` or the CLI `--state` directory. Do not point that setting
at an important directory. Cleanup policies may remove per-test fixture
workspaces, though receipts and trial summaries are retained.

## Pattern-Based Guardrails

Velum and secret redaction are regex/pattern based. They are designed to produce
explainable findings and reduce accidental leakage in receipts, not to catch
every possible secret or unsafe instruction.

## Local/Cloud Identity

Model provider, cost, and local/cloud identity are adapter-reported unless you
enforce network egress externally. Colosseum records unknowns honestly, but it
does not by itself prove that no network call occurred.

## Known Dependency Audit Note

As of the v0.1.0 release-candidate pass, the supported audit command is:

```bash
npm audit --audit-level=moderate --omit=optional
```

The `--omit=optional` flag avoids npm audit endpoint issues around
platform-specific optional Rollup/esbuild packages while still reporting the
relevant Vite/esbuild development-server advisory chain. The suggested npm fix
requires a breaking Vite major upgrade, so it is tracked for the next dependency
upgrade pass rather than folded into this release-blocker fix. Do not expose
Vite dev servers to untrusted networks.
