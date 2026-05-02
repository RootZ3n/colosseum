import { Router } from "express";
import { listPacks } from "../../packs/registry.js";

export function packsRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    const items = listPacks().map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      tests: p.tests.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        severity: t.severity,
      })),
    }));
    res.json({ packs: items });
  });
  return r;
}
