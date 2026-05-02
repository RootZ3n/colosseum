import { Router } from "express";
import { ReceiptStore } from "../../receipts/receipt-store.js";

export function receiptsRouter(stateRoot: string): Router {
  const r = Router();
  const store = new ReceiptStore(stateRoot);

  r.get("/:trialId", async (req, res) => {
    const list = await store.list(req.params.trialId);
    res.json({ receipts: list });
  });

  r.get("/:trialId/:testId", async (req, res) => {
    const r1 = await store.get(req.params.trialId, req.params.testId);
    if (!r1) {
      res.status(404).json({ error: "no such receipt" });
      return;
    }
    res.json(r1);
  });

  return r;
}
