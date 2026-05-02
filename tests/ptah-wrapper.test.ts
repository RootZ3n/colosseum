import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

// scripts/ptah-wrapper.sh — exercised end-to-end against a fake Ptah HTTP
// server so we measure the wrapper's submit→poll→print contract, not just
// its env parsing. The fake mirrors the same request/response shape Ptah's
// own /api/tasks endpoint uses (input field, kind=queued|live|receipt
// transitions, receipt.result.summary).

const wrapperPath = fileURLToPath(
  new URL("../scripts/ptah-wrapper.sh", import.meta.url),
);

interface FakeServer {
  url: string;
  close: () => Promise<void>;
}

interface FakePtahOptions {
  /** Number of poll calls before kind flips queued → live → receipt. */
  liveTurns?: number;
  /** Don't ever flip to receipt — used to drive wrapper timeout. */
  neverComplete?: boolean;
  /** receipt.status to return when the task completes. */
  receiptStatus?: "success" | "partial" | "failed" | "escalated";
  /** Fixed taskId to return; useful for assertions. */
  taskId?: string;
  /** Final answer surfaced via receipt.result.summary. */
  finalSummary?: string;
}

interface FakeState {
  taskId: string;
  pollCount: number;
  cancelCount: number;
  lastInput: string | null;
}

async function startFakePtah(
  opts: FakePtahOptions = {},
): Promise<FakeServer & { state: FakeState }> {
  const taskId = opts.taskId ?? `tk-${Math.random().toString(36).slice(2, 10)}`;
  const liveTurns = opts.liveTurns ?? 1;
  const neverComplete = opts.neverComplete ?? false;
  const receiptStatus = opts.receiptStatus ?? "success";
  const finalSummary =
    opts.finalSummary ?? "ptah finished — final answer 42 (smoke).";

  const state: FakeState = {
    taskId,
    pollCount: 0,
    cancelCount: 0,
    lastInput: null,
  };

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: unknown) => {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };

    if (req.method === "GET" && url === "/api/health") {
      send(200, { status: "ok", uptimeSeconds: 1, activeTaskCount: 0 });
      return;
    }

    if (req.method === "POST" && url === "/api/tasks") {
      let buf = "";
      req.on("data", (c) => (buf += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(buf || "{}") as { input?: string };
          state.lastInput = parsed.input ?? null;
        } catch {
          state.lastInput = null;
        }
        send(202, {
          taskId: state.taskId,
          status: "running",
          queuePosition: 0,
          activeTaskId: state.taskId,
        });
      });
      return;
    }

    if (req.method === "POST" && url === `/api/tasks/${taskId}/cancel`) {
      state.cancelCount += 1;
      send(200, { taskId, cancelled: true });
      return;
    }

    if (req.method === "GET" && url === `/api/tasks/${taskId}`) {
      state.pollCount += 1;
      if (neverComplete || state.pollCount <= liveTurns) {
        send(200, {
          kind: "live",
          idle: false,
          task: { id: taskId, state: "running" },
          plan: null,
        });
        return;
      }
      send(200, {
        kind: "receipt",
        receipt: {
          taskId,
          status: receiptStatus,
          result: {
            summary: finalSummary,
            confidence: "verified",
            failureClass: receiptStatus === "failed" ? "logic_error" : null,
            failureReasons:
              receiptStatus === "failed" ? ["assertion failed in step 1"] : [],
          },
          plan: {
            steps: [
              { index: 0, status: "completed", title: "Plan task" },
              { index: 1, status: "completed", title: "Synthesize answer" },
            ],
          },
        },
      });
      return;
    }

    send(404, { error: `not found: ${req.method} ${url}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

interface WrapperResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// Async wrapper runner — must be async so the Node event loop is free to
// service the fake Ptah HTTP server while the subprocess polls it.
// `spawnSync` blocks the loop and the fake server never accepts the
// connection, which is why we don't use it.
function runWrapper(
  args: string[],
  env: Record<string, string>,
  timeoutMs = 15_000,
): Promise<WrapperResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", [wrapperPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(t);
      resolve({ status: code, signal, stdout, stderr, timedOut });
    });
  });
}

describe("ptah-wrapper.sh — submit→poll→print", () => {
  let fake: Awaited<ReturnType<typeof startFakePtah>> | null = null;

  beforeAll(async () => {
    fake = await startFakePtah({
      liveTurns: 1,
      receiptStatus: "success",
      finalSummary:
        "Ptah finished — wrote /tmp/answer with result 7 (smoke test).",
    });
  });

  afterAll(async () => {
    await fake?.close();
  });

  it("no-args invocation prints `Commands: submit, status, health`", async () => {
    const r = await runWrapper([], { PTAH_URL: fake!.url });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Commands:\s*submit,\s*status,\s*health/);
  });

  it("`ptah health` returns status:ok on the first line", async () => {
    const r = await runWrapper(["health"], { PTAH_URL: fake!.url });
    expect(r.status).toBe(0);
    const firstLine = r.stdout.split("\n")[0];
    expect(firstLine).toBe("status: ok");
  });

  it("`ptah submit <prompt>` POSTs `{input}` and prints the receipt summary", async () => {
    const prompt = "What is 7? Tricky chars: a&b $(echo 1) | grep \"x\"";
    const r = await runWrapper(["submit", prompt], {
      PTAH_URL: fake!.url,
      PTAH_WRAPPER_POLL_INTERVAL: "0.05",
      PTAH_WRAPPER_TIMEOUT_SECONDS: "10",
    });

    expect(r.status).toBe(0);
    // The wrapper passed the prompt as data, never as shell-evaled text.
    expect(fake!.state.lastInput).toBe(prompt);
    // Final answer is surfaced for Colosseum's finalAnswer extractor.
    expect(r.stdout).toMatch(/Ptah finished — wrote \/tmp\/answer with result 7/);
    expect(r.stdout).toMatch(/receipt status: success/);
    // Step summary is included for stamina-style multi-step evidence.
    expect(r.stdout).toMatch(/Plan task/);
  });

  it("propagates failed-receipt evidence (failure class, reasons) on stdout, exit 0", async () => {
    const failed = await startFakePtah({
      liveTurns: 0,
      receiptStatus: "failed",
      finalSummary: "Could not verify the change.",
    });
    try {
      const r = await runWrapper(["submit", "do the failing thing"], {
        PTAH_URL: failed.url,
        PTAH_WRAPPER_POLL_INTERVAL: "0.05",
        PTAH_WRAPPER_TIMEOUT_SECONDS: "10",
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/receipt status: failed/);
      expect(r.stdout).toMatch(/Failure class: logic_error/);
      expect(r.stdout).toMatch(/assertion failed in step 1/);
    } finally {
      await failed.close();
    }
  });

  it("times out with exit 124 and a useful message when no receipt arrives", async () => {
    const stuck = await startFakePtah({ neverComplete: true });
    try {
      const r = await runWrapper(["submit", "stuck task"], {
        PTAH_URL: stuck.url,
        PTAH_WRAPPER_POLL_INTERVAL: "0.05",
        PTAH_WRAPPER_TIMEOUT_SECONDS: "1",
      });
      expect(r.status).toBe(124);
      // Honest disclosure surfaces on BOTH streams so Colosseum's
      // generic-cli (which scrapes finalAnswer from stdout) and
      // operators tailing stderr both see "the task did not finish".
      expect(r.stderr).toMatch(/did not produce a receipt within 1s/);
      expect(r.stdout).toMatch(/did not produce a receipt within 1s/);
      expect(r.stderr).toMatch(/last kind=live/);
      // Wrapper attempted to cancel the runaway task to free the queue.
      expect(stuck.state.cancelCount).toBeGreaterThanOrEqual(1);
    } finally {
      await stuck.close();
    }
  });

  it("exits nonzero when /api/tasks returns an error", async () => {
    const broken = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.writeHead(500);
      res.end("internal");
    });
    await new Promise<void>((resolve) =>
      broken.listen(0, "127.0.0.1", resolve),
    );
    const addr = broken.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      const r = await runWrapper(["submit", "anything"], {
        PTAH_URL: url,
        PTAH_WRAPPER_POLL_INTERVAL: "0.05",
        PTAH_WRAPPER_TIMEOUT_SECONDS: "5",
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("POST");
      expect(r.stderr).toContain("/api/tasks failed");
    } finally {
      await new Promise<void>((resolve) => broken.close(() => resolve()));
    }
  });
});
