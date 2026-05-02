import type { AgentAdapter } from "./types.js";
import { createAedisAdapter } from "./aedis.js";
import { createBetterClawAdapter } from "./betterclaw.js";
import { createOpenClawAdapter } from "./openclaw.js";
import { createHermesAdapter } from "./hermes.js";
import { createGenericCliAdapter } from "./generic-cli.js";
import { createMockAdapter } from "./mock.js";
import { createPtahAdapter } from "./ptah.js";
import {
  createSquidleyAdapter,
  createSquidleyV2Adapter,
} from "./squidley-http.js";

const LAB_ADAPTERS = new Set(["ptah", "squidley-v2"]);

const factories: Record<string, () => AgentAdapter> = {
  mock: createMockAdapter,
  aedis: createAedisAdapter,
  betterclaw: createBetterClawAdapter,
  openclaw: createOpenClawAdapter,
  hermes: createHermesAdapter,
  ptah: createPtahAdapter,
  squidley: createSquidleyAdapter,
  "squidley-v2": createSquidleyV2Adapter,
  "generic-cli": createGenericCliAdapter,
};

export function listAdapters(): AgentAdapter[] {
  return Object.entries(factories)
    .filter(([id]) => isPublicAdapter(id) || isLabAdapterEnabled(id))
    .map(([, f]) => f());
}

export function getAdapter(id: string): AgentAdapter {
  const f = factories[id];
  if (!f) {
    throw new Error(
      `Unknown adapter "${id}". Available: ${Object.keys(factories).join(", ")}`,
    );
  }
  return f();
}

export function adapterIds(): string[] {
  return Object.keys(factories);
}

export function publicAdapterIds(): string[] {
  return Object.keys(factories).filter(isPublicAdapter);
}

function isPublicAdapter(id: string): boolean {
  return !LAB_ADAPTERS.has(id);
}

function isLabAdapterEnabled(id: string): boolean {
  if (!LAB_ADAPTERS.has(id)) return false;
  const enabled = process.env.COLOSSEUM_LAB_ADAPTERS ?? "";
  return enabled
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .some((x) => x === id || x === "all");
}
