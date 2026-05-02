import { describe, it, expect } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  listAdapters,
  getAdapter,
  adapterIds,
  publicAdapterIds,
} from "@colosseum/adapters/registry.js";

async function tmpdir(): Promise<string> {
  const d = path.join(os.tmpdir(), `colosseum-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === "string") process.env[name] = value;
  else delete process.env[name];
}

async function withJsonServer(
  handler: (req: http.IncomingMessage, body: unknown) => Promise<unknown> | unknown,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? JSON.parse(raw) : undefined;
        const result = await handler(req, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind tcp");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

describe("adapter registry", () => {
  it("registers all adapter ids, including lab-only adapters", () => {
    const ids = adapterIds().sort();
    expect(ids).toEqual([
      "aedis",
      "betterclaw",
      "generic-cli",
      "hermes",
      "mock",
      "openclaw",
      "ptah",
      "squidley",
      "squidley-v2",
    ]);
  });

  it("keeps lab-only adapters out of the public list unless explicitly enabled", async () => {
    const old = process.env.COLOSSEUM_LAB_ADAPTERS;
    delete process.env.COLOSSEUM_LAB_ADAPTERS;
    expect(publicAdapterIds().sort()).toEqual([
      "aedis",
      "betterclaw",
      "generic-cli",
      "hermes",
      "mock",
      "openclaw",
      "squidley",
    ]);
    expect(listAdapters().map((a) => a.id)).not.toContain("ptah");
    expect(listAdapters().map((a) => a.id)).not.toContain("squidley-v2");

    process.env.COLOSSEUM_LAB_ADAPTERS = "ptah,squidley-v2";
    expect(listAdapters().map((a) => a.id)).toContain("ptah");
    expect(listAdapters().map((a) => a.id)).toContain("squidley-v2");
    restoreEnv("COLOSSEUM_LAB_ADAPTERS", old);
  });

  it("each adapter exposes the AgentAdapter contract", () => {
    for (const a of listAdapters()) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(typeof a.description).toBe("string");
      expect(typeof a.capabilities).toBe("object");
      expect(typeof a.startSession).toBe("function");
      expect(typeof a.sendPrompt).toBe("function");
      expect(typeof a.stop).toBe("function");
      expect(typeof a.collectArtifacts).toBe("function");
      expect(typeof a.getModelInfo).toBe("function");
      expect(typeof a.getCostInfo).toBe("function");
    }
  });

  it("getAdapter throws for unknown id", () => {
    expect(() => getAdapter("does-not-exist")).toThrow(/Unknown adapter/);
  });
});

describe("mock adapter", () => {
  it("startSession returns a session and reports local model identity", async () => {
    const adapter = getAdapter("mock");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    expect(handle.modelInfo.location).toBe("local");
    expect(handle.modelInfo.provider).toBe("colosseum-mock");
    const cost = await adapter.getCostInfo(handle);
    expect(cost.reported).toBe(true);
    expect(cost.estimatedCostUsd).toBe(0);
  });

  it("edits files in the workspace and returns artifacts", async () => {
    const adapter = getAdapter("mock");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const result = await adapter.sendPrompt(handle, "edit out/result.txt with content: hello");
    const file = await fs.readFile(path.join(ws, "out", "result.txt"), "utf8");
    expect(file).toBe("hello");
    expect(result.artifacts.find((a) => a.path.includes("result.txt"))).toBeDefined();
    expect(result.exitCode).toBe(0);
  });

  it("does not write outside the workspace", async () => {
    const adapter = getAdapter("mock");
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    const result = await adapter.sendPrompt(handle, "edit ../escape.txt with content: nope");
    // Adapter must refuse — the key invariant is that nothing escapes the workspace.
    expect(result.exitCode).not.toBe(0);
    const exists = await fs.stat(path.join(ws, "..", "escape.txt")).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("aedis adapter", () => {
  it("health() reports false when AEDIS_BIN points at nothing on PATH", async () => {
    const adapter = getAdapter("aedis");
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "definitely-not-a-real-binary-xyz";
    const r = await adapter.health();
    process.env.AEDIS_BIN = old;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it("health() rejects a real binary that doesn't expose Aedis-style commands (echo)", async () => {
    // After the protocol fix, the Aedis adapter requires the binary to print
    // a "Commands: …" usage line that includes `submit`. /bin/echo doesn't,
    // so it must be rejected — preventing protocol mismatches from being
    // misclassified as agent behavioral failures.
    const adapter = getAdapter("aedis");
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "/bin/echo";
    const r = await adapter.health();
    process.env.AEDIS_BIN = old;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Commands: …/);
  });

  it("startSession declares provider=aedis and inherits AEDIS_BIN", async () => {
    const adapter = getAdapter("aedis");
    const old = process.env.AEDIS_BIN;
    process.env.AEDIS_BIN = "/bin/echo";
    const ws = await tmpdir();
    const handle = await adapter.startSession({ workspace: ws });
    expect(handle.modelInfo.provider).toBe("aedis");
    // Aedis adapter wraps generic-cli; cost remains "not reported" honestly.
    const cost = await adapter.getCostInfo(handle);
    expect(cost.reported).toBe(false);
    process.env.AEDIS_BIN = old;
  });
});

describe("generic-cli adapter", () => {
  it("admits unknown model/cost truthfully when not configured", async () => {
    const adapter = getAdapter("generic-cli");
    const ws = await tmpdir();
    const handle = await adapter.startSession({
      workspace: ws,
      extra: { command: "echo", args: ["mock-output"] },
    });
    expect(handle.modelInfo.model).toBe("unknown");
    expect(handle.modelInfo.provider).toBe("unknown");
    const cost = await adapter.getCostInfo(handle);
    expect(cost.reported).toBe(false);
    expect(cost.note).toMatch(/not introspect/i);
  });

  it("runs an external command and captures stdout", async () => {
    const adapter = getAdapter("generic-cli");
    const ws = await tmpdir();
    const handle = await adapter.startSession({
      workspace: ws,
      extra: { command: "echo" },
    });
    const result = await adapter.sendPrompt(handle, "ave imperator");
    expect(result.stdout).toContain("ave imperator");
    expect(result.exitCode).toBe(0);
  });

  it("returns exit code 127 with an honest error event when binary is missing", async () => {
    const adapter = getAdapter("generic-cli");
    const ws = await tmpdir();
    const handle = await adapter.startSession({
      workspace: ws,
      extra: { command: "definitely-not-a-real-binary-xyz" },
    });
    const result = await adapter.sendPrompt(handle, "anything");
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toMatch(/not found|ENOENT|spawn/i);
    const errorEvent = result.events.find((e) => e.kind === "error");
    expect(errorEvent).toBeDefined();
  });

  it("kills the child after timeoutMs and reports exit code 124", async () => {
    const adapter = getAdapter("generic-cli");
    const ws = await tmpdir();
    const handle = await adapter.startSession({
      workspace: ws,
      timeoutMs: 200,
      extra: { command: "sleep" },
    });
    const result = await adapter.sendPrompt(handle, "5");
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/timeout/i);
  }, 5_000);
});

describe("OpenClaw and BetterClaw adapters", () => {
  it("OpenClaw health() fails before tests when the launcher is missing", async () => {
    const old = process.env.OPENCLAW_BIN;
    process.env.OPENCLAW_BIN = "definitely-not-a-real-openclaw-binary-xyz";
    const r = await getAdapter("openclaw").health();
    restoreEnv("OPENCLAW_BIN", old);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OpenClaw adapter could not launch/);
  });

  it("BetterClaw health() fails before tests when the launcher is missing", async () => {
    const old = process.env.BETTERCLAW_BIN;
    process.env.BETTERCLAW_BIN = "definitely-not-a-real-betterclaw-binary-xyz";
    const r = await getAdapter("betterclaw").health();
    restoreEnv("BETTERCLAW_BIN", old);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/BetterClaw adapter could not launch/);
  });

  it("BetterClaw declares a distinct adapter identity", async () => {
    const adapter = getAdapter("betterclaw");
    const ws = await tmpdir();
    const handle = await adapter.startSession({
      workspace: ws,
      extra: { command: "echo" },
    });
    expect(handle.modelInfo.provider).toBe("betterclaw");
    const cost = await adapter.getCostInfo(handle);
    expect(cost.reported).toBe(false);
  });
});

describe("Squidley HTTP adapters", () => {
  it("tests public Squidley through the /api/chat route", async () => {
    const old = process.env.SQUIDLEY_URL;
    const server = await withJsonServer((req, body) => {
      if (req.method === "GET" && req.url === "/api/local/health") return { ok: true };
      if (req.method === "POST" && req.url === "/api/chat") {
        const message = (body as { message?: unknown }).message;
        return {
          ok: true,
          provider: "local",
          cloudUsed: false,
          toolsUsed: false,
          model: "public-local-model",
          reply: `public reply: ${String(message)}`,
          promptEvalCount: 2,
          evalCount: 3,
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 1,
        };
      }
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });

    try {
      process.env.SQUIDLEY_URL = server.baseUrl;
      const adapter = getAdapter("squidley");
      await expect(adapter.health()).resolves.toMatchObject({ ok: true });
      const ws = await tmpdir();
      const handle = await adapter.startSession({ workspace: ws });
      const result = await adapter.sendPrompt(handle, "ave squidley");
      expect(result.exitCode).toBe(0);
      expect(result.finalAnswer).toBe("public reply: ave squidley");
      expect(result.modelInfo.model).toBe("public-local-model");
      expect(result.costInfo).toMatchObject({
        reported: true,
        promptTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      });
    } finally {
      restoreEnv("SQUIDLEY_URL", old);
      await server.close();
    }
  });

  it("tests Squidley-v2 through the lab-only /chat route", async () => {
    const old = process.env.SQUIDLEY_V2_URL;
    const server = await withJsonServer((req, body) => {
      if (req.method === "GET" && req.url === "/health") return { status: "ok" };
      if (req.method === "POST" && req.url === "/chat") {
        const messages = (body as { messages?: Array<{ content?: unknown }> }).messages ?? [];
        return {
          text: `v2 reply: ${String(messages[0]?.content ?? "")}`,
          model: "squidley-v2-local-model",
          tokensIn: 4,
          tokensOut: 6,
          estimatedCostUsd: 0.01,
        };
      }
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });

    try {
      process.env.SQUIDLEY_V2_URL = server.baseUrl;
      const adapter = getAdapter("squidley-v2");
      await expect(adapter.health()).resolves.toMatchObject({ ok: true });
      const ws = await tmpdir();
      const handle = await adapter.startSession({ workspace: ws });
      const result = await adapter.sendPrompt(handle, "ave v2");
      expect(result.exitCode).toBe(0);
      expect(result.finalAnswer).toBe("v2 reply: ave v2");
      expect(result.modelInfo.model).toBe("squidley-v2-local-model");
      expect(result.costInfo).toMatchObject({
        reported: true,
        promptTokens: 4,
        outputTokens: 6,
        totalTokens: 10,
        estimatedCostUsd: 0.01,
      });
    } finally {
      restoreEnv("SQUIDLEY_V2_URL", old);
      await server.close();
    }
  });
});
