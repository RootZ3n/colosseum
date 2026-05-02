import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentsRouter } from "./routes/agents.js";
import { packsRouter } from "./routes/packs.js";
import { trialsRouter } from "./routes/trials.js";
import { receiptsRouter } from "./routes/receipts.js";
import { defaultStateRoot, TrialStore } from "../storage/index.js";

// COLOSSEUM_STATE_ROOT is the canonical env var (matches systemd unit + docs).
// COLOSSEUM_STATE is accepted for backward compat with v0.1 deployments.
const stateRoot =
  process.env.COLOSSEUM_STATE_ROOT ??
  process.env.COLOSSEUM_STATE ??
  defaultStateRoot();
const port = Number(process.env.COLOSSEUM_PORT ?? 18799);
const host = process.env.COLOSSEUM_HOST ?? "127.0.0.1";

export async function buildApp(): Promise<express.Express> {
  await new TrialStore(stateRoot).ensureLayout();
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, stateRoot, version: "0.1.0" }),
  );

  app.use("/api/agents", agentsRouter());
  app.use("/api/packs", packsRouter());
  app.use("/api/trials", trialsRouter(stateRoot));
  app.use("/api/receipts", receiptsRouter(stateRoot));

  // Serve built UI when present.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const uiDir = path.resolve(here, "../ui");
    app.use(express.static(uiDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(uiDir, "index.html")));
  } catch {
    // dev mode — Vite serves the UI.
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildApp().then((app) => {
    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`Colosseum API listening on http://${host}:${port}`);
      console.log(`UI:        http://${host}:${port}/`);
      console.log(`Health:    http://${host}:${port}/api/health`);
      console.log(`State:     ${stateRoot}`);
    });
  });
}
