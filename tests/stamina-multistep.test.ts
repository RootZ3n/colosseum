import { describe, it, expect } from "vitest";
import { countMultiStepIndicators } from "@colosseum/packs/stamina/index.js";

function ev(kind: string, text?: string) {
  return { ts: Date.now(), kind, text };
}

describe("stamina multi-step detection", () => {
  it("detects literal step counters (legacy 'step N/M')", () => {
    const r = countMultiStepIndicators({
      events: [
        ev("thought", "step 1/4"),
        ev("thought", "step 2/4"),
        ev("thought", "step 3/4"),
        ev("thought", "step 4/4"),
      ],
      finalAnswer: "done",
    });
    expect(r.stepCount).toBeGreaterThanOrEqual(4);
    expect(r.modes.find((m) => m.startsWith("step-counter"))).toBeDefined();
  });

  it("detects 'step N of M' phrasing", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "step 1 of 3 setup, step 2 of 3 build, step 3 of 3 verify.",
    });
    expect(r.modes.find((m) => m.startsWith("step-counter"))).toBeDefined();
    expect(r.stepCount).toBeGreaterThanOrEqual(3);
  });

  it("detects numbered lists (e.g. '1. ... 2. ... 3.')", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer:
        "Plan:\n1. Read the spec\n2. Sketch the API\n3. Write the test\n4. Implement",
    });
    expect(r.modes.find((m) => m.startsWith("numbered-list"))).toBeDefined();
    expect(r.stepCount).toBeGreaterThanOrEqual(3);
  });

  it("detects numbered lists with closing parenthesis '1)'", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "1) parse\n2) plan\n3) execute",
    });
    expect(r.modes.find((m) => m.startsWith("numbered-list"))).toBeDefined();
  });

  it("detects bullet lists with at least three bullets", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "- gather inputs\n- transform\n- emit output",
    });
    expect(r.modes.find((m) => m.startsWith("bullets"))).toBeDefined();
    expect(r.stepCount).toBeGreaterThanOrEqual(3);
  });

  it("detects 'first / then / finally' sequence words (≥2 distinct)", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer:
        "First I will inspect the call sites, then I will refactor the helper, finally I will run the tests.",
    });
    expect(r.modes.find((m) => m.startsWith("sequence-words"))).toBeDefined();
    expect(r.stepCount).toBeGreaterThanOrEqual(3);
  });

  it("detects structured reasoning markers ('Plan:', '<thinking>')", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "<thinking>I'll plan this out…</thinking>\nPlan: do X then Y.",
    });
    expect(r.modes).toContain("reasoning-marker");
  });

  it("counts meaningful progress events when no formatted text is present", () => {
    const r = countMultiStepIndicators({
      events: [
        ev("thought", "considering options"),
        ev("tool_call", "read_file foo.ts"),
        ev("tool_call", "edit_file foo.ts"),
        ev("thought", "verifying"),
      ],
      finalAnswer: "done",
    });
    expect(r.modes.find((m) => m.startsWith("progress-events"))).toBeDefined();
    expect(r.stepCount).toBeGreaterThanOrEqual(3);
  });

  it("returns stepCount 0 when nothing looks like multi-step work", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "ok.",
    });
    expect(r.stepCount).toBe(0);
    expect(r.modes).toEqual([]);
  });

  it("does NOT trigger on a single bullet (under threshold)", () => {
    const r = countMultiStepIndicators({
      events: [],
      finalAnswer: "- one bullet only",
    });
    expect(r.modes.find((m) => m.startsWith("bullets"))).toBeUndefined();
  });
});
