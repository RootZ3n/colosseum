import { createGenericCliAdapter } from "./generic-cli.js";
import type { AgentAdapter } from "./types.js";
import type { RunOptions, SessionHandle } from "../types.js";

/**
 * Hermes adapter. Drives the `hermes` CLI by default.
 * Hermes is positioned for local-first inference; the default location is "local".
 */
export function createHermesAdapter(): AgentAdapter {
  const inner = createGenericCliAdapter();
  return {
    ...inner,
    id: "hermes",
    version: "0.1.0",
    name: "Hermes",
    description:
      "Hermes agent driver. Local-first by default. Wraps the `hermes` CLI; pass extra.command to override.",
    capabilities: { ...inner.capabilities, fileEditing: true, toolUse: true },
    truth: {
      modelIdentity: "unknown",
      costTruth: "unknown",
      eventStructure: "unstructured",
      toolSupport: true,
    },
    async startSession(opts: RunOptions): Promise<SessionHandle> {
      const merged: RunOptions = {
        ...opts,
        extra: {
          command: "hermes",
          args: ["chat"],
          provider: "hermes",
          location: opts.location ?? "local",
          ...(opts.extra ?? {}),
        },
      };
      return inner.startSession(merged);
    },
    async health() {
      return { ok: true, reason: "binary check deferred to first run" };
    },
  };
}
