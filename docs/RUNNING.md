# Running Colosseum

This doc covers three modes: **dev** (hot-reload), **local production**
(single-process serves API + UI), and **advanced Linux systemd** (long-running
service).

## Default ports

| Surface           | Port    | Override env             |
|-------------------|---------|--------------------------|
| API + bundled UI  | `18799` | `COLOSSEUM_PORT`         |
| Vite dev server   | `5180`  | `COLOSSEUM_UI_PORT`      |
| Bind host         | `127.0.0.1` | `COLOSSEUM_HOST`     |

The API server binds **127.0.0.1 by default** — Colosseum is a local tool. Set
`COLOSSEUM_HOST=0.0.0.0` if you want it reachable from the LAN, and put a real
reverse proxy in front of it for anything beyond that.

## Quickstart — local production

This is the mode you want for "open the UI in a browser":

```bash
npm ci
npm run build         # compiles dist/ + bundled UI
npm run start         # node dist/api/server.js
```

Then open: **<http://127.0.0.1:18799>**

Health check: `curl http://127.0.0.1:18799/api/health` → `{"ok":true,"stateRoot":...,"version":"0.1.0"}`

Windows PowerShell uses the same npm commands. For a health check without
`curl`, run:

```powershell
Invoke-RestMethod http://127.0.0.1:18799/api/health
```

## Dev mode (hot reload)

Two processes — Vite for the UI, tsx-watch for the API:

```bash
npm run dev
# api: http://127.0.0.1:18799
# ui:  http://127.0.0.1:5180  (Vite proxies /api/* to the API)
```

Open the **UI dev URL** in dev mode (not the API URL) — `http://127.0.0.1:5180`.

Individual processes if you want them in separate terminals:

```bash
npm run dev:api       # API only with hot reload
npm run dev:ui        # UI only
```

## Available scripts

| Script              | What it does                                              |
|---------------------|-----------------------------------------------------------|
| `npm run dev`       | Vite + API in one terminal (concurrently, kill-on-close) |
| `npm run dev:api`   | API only, hot-reload via `tsx watch`                     |
| `npm run dev:ui`    | UI only, Vite dev server                                 |
| `npm run build`     | Compile TS + build UI bundle into `dist/`                |
| `npm run start`     | Local production: serves API and bundled UI on 18799     |
| `npm run start:api` | Alias for `start`                                         |
| `npm run start:ui`  | `vite preview` of the built bundle (UI only, no API)     |
| `npm run cli -- …`  | Run the `colosseum` CLI without compiling                |
| `npm run smoke`     | Cross-platform passing mock trial for first-run checks   |
| `npm run smoke:fail` | Cross-platform intentional failing demo; expects trial exit 2 |
| `npm run verify:release` | Cross-platform release gate: typecheck, tests, build, CLI lists, smoke |
| `npm run audit:release` | Supported audit command (`npm audit --audit-level=moderate --omit=optional`) |
| `npm run typecheck` | `tsc --noEmit`                                            |
| `npm test`          | `vitest run`                                              |

## Health endpoint

`GET /api/health` returns:

```json
{ "ok": true, "stateRoot": "/abs/path/to/colosseum-state", "version": "0.1.0" }
```

## State directory

Trial summaries, receipts, fixtures, and reports all live under
**`COLOSSEUM_STATE_ROOT`** (defaults to `./colosseum-state` relative to where
the server was launched). Layout:

```
colosseum-state/
├── trials/<trialId>.json
├── receipts/<trialId>/<testId>.json
├── receipts/<trialId>/<testId>.md
├── fixtures/<trialId>/<testId>-<rand>/...
├── artifacts/  agents/  reports/    (reserved)
```

Workspace cleanup policy is `success` by default — PASS/WARN test fixtures are
removed at end-of-trial; FAIL/ERROR fixtures are preserved as evidence.
Receipts and trial summaries are never deleted by cleanup.

## Run a mock trial

For a deterministic passing first-run check:

```bash
npm run smoke
```

To inspect an intentional failing receipt:

```bash
npm run smoke:fail
```

Raw CLI equivalents:

```bash
npm run cli -- run --agent mock --pack stamina --quiet
npm run cli -- list packs
npm run cli -- report <trialId>
```

The trial appears immediately on the dashboard at <http://127.0.0.1:18799/>
(refresh the page) — every run produces a JSON + Markdown receipt under
`colosseum-state/receipts/<trialId>/`.

To smoke against a real local agent without a full Aedis install:

```bash
AEDIS_BIN=/bin/echo npm run cli -- run --agent aedis --pack truthfulness
```

## Advanced Linux: running as a systemd service

A template unit lives at `docs/systemd/colosseum.service`. Copy it, replace the
placeholder user/group and paths for your machine, then install:

```bash
sudo install -m 0644 docs/systemd/colosseum.service \
    /etc/systemd/system/colosseum.service
sudo systemctl daemon-reload
sudo systemctl enable --now colosseum
```

Operate:

```bash
sudo systemctl status colosseum
sudo journalctl -u colosseum -f
sudo systemctl restart colosseum
sudo systemctl stop colosseum
```

You can also run `bash scripts/colosseum-status.sh` for a quick "is the unit
healthy + is the HTTP endpoint up" summary without root.

The example unit uses placeholders:

- `User=colosseum`
- `Group=colosseum`
- `WorkingDirectory=/opt/colosseum`
- `ExecStart=/usr/bin/npm run start`
- `Environment=COLOSSEUM_PORT=18799`
- `Environment=COLOSSEUM_STATE_ROOT=/var/lib/colosseum`
- `Restart=on-failure`

Edit these values before installing. If your `npm` isn't at `/usr/bin/npm`, run
`which npm` and update `ExecStart`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser can't reach `:18799` | Server not running, or bound to a different host. Check `curl 127.0.0.1:18799/api/health`. |
| UI loads but API calls 404 | You opened the dev port `:5180` while only the API is running, or vice versa. In dev, open `:5180`; in production, open `:18799`. |
| "EADDRINUSE :18799" | Another process holds the port. `ss -ltnp \| grep 18799` to find it, or set `COLOSSEUM_PORT` to something else. |
| Receipts directory empty after a run | Trial wrote to a different `COLOSSEUM_STATE_ROOT`. The `/api/health` payload tells you the truth — match the CLI's `--state` flag to it. |
