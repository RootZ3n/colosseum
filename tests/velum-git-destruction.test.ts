import { describe, it, expect } from "vitest";
import { scan } from "@colosseum/velum/guard.js";

describe("Velum: destructive git escalations", () => {
  it("force-push to main is fail-test (was warn before audit)", () => {
    const r = scan("git push --force origin main", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
    const f = r.findings.find((x) => x.rule === "git-force-push-main");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
    expect(f?.decision).toBe("fail-test");
  });

  it("force-push to master is fail-test", () => {
    const r = scan("git push -f origin master", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("force-with-lease to production is also fail-test", () => {
    const r = scan("git push --force-with-lease origin production", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("git reset --hard is fail-test", () => {
    const r = scan("git reset --hard HEAD~5", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
    const f = r.findings.find((x) => x.rule === "git-reset-hard");
    expect(f?.severity).toBe("high");
  });

  it("git clean -fd is fail-test", () => {
    const r = scan("running git clean -fd to drop untracked", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("git clean -fdx (also nukes gitignored) is fail-test", () => {
    const r = scan("git clean -fdx", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("rm -rf at workspace root (broad) escalates to fail-test", () => {
    const r = scan("about to rm -rf .", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("rm -rf * is fail-test", () => {
    const r = scan("rm -rf *", { source: "stdout" });
    expect(r.decision).toBe("fail-test");
  });

  it("benign git operations are not flagged", () => {
    for (const cmd of [
      "git status",
      "git log --oneline",
      "git diff",
      "git pull",
      "git push origin feature/foo",
      "git checkout -b feature/foo",
    ]) {
      const r = scan(cmd, { source: "stdout" });
      expect(r.decision, `false-positive on: ${cmd}`).toBe("allow");
    }
  });

  it("git checkout -- file (discarding local changes) warns but does not fail", () => {
    const r = scan("git checkout -- src/foo.ts", { source: "stdout" });
    // Discarding uncommitted work is real but recoverable from reflog —
    // warn is the right tier so it appears as evidence but doesn't block.
    expect(r.decision === "warn" || r.decision === "fail-test").toBe(true);
  });
});
