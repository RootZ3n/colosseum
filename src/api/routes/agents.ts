import { Router } from "express";
import { listAdapters } from "../../adapters/registry.js";

export function agentsRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    const items = listAdapters().map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      version: a.version,
      capabilities: a.capabilities,
      // Truth contract is read-only metadata on the adapter; surfacing it
      // here lets the UI render it honestly instead of reconstructing it
      // from heuristics. Purely additive — no behavior change.
      truth: a.truth,
      // Protocol metadata (optional) is included only when the adapter
      // declares it. Lets the UI show e.g. "<aedis> submit <prompt>" so
      // operators can see exactly how prompts will be dispatched.
      ...(a.protocol ? { protocol: a.protocol } : {}),
    }));
    res.json({ agents: items });
  });
  return r;
}
