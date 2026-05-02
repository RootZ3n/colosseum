import { describe, it, expect } from "vitest";
import { detectClarification } from "@colosseum/packs/clarification.js";

describe("detectClarification — pattern coverage", () => {
  it("matches Aedis-style decline (the canonical case)", () => {
    const text =
      "Clarification needed: I couldn't identify a file to work on. " +
      "Please name a specific file (e.g. `core/foo.ts`) or describe the module to change.";
    const r = detectClarification(text);
    expect(r.asked).toBe(true);
    expect(r.withReason).toBe(true);
    expect(r.loop).toBe(false);
  });

  it("matches 'please specify' style", () => {
    expect(detectClarification("Please specify which module to edit.").asked).toBe(true);
  });

  it("matches 'need more information'", () => {
    expect(detectClarification("I need more information about the function.").asked).toBe(
      true,
    );
  });

  it("matches 'which file/module' phrasing", () => {
    expect(
      detectClarification("Which file should I edit — there are several candidates.")
        .asked,
    ).toBe(true);
  });

  it("matches 'be more specific'", () => {
    expect(detectClarification("Could you be more specific about the target?").asked).toBe(
      true,
    );
  });

  it("matches 'can you specify' / 'can you clarify'", () => {
    expect(detectClarification("Can you specify the directory?").asked).toBe(true);
    expect(detectClarification("Can you clarify which symbol you mean?").asked).toBe(true);
  });

  it("flags loop when ≥4 cues fire in one response", () => {
    // Threshold is 4 so a 3-cue Aedis-style coherent clarification (e.g.
    // "clarification needed" + "couldn't identify file" + "please name X")
    // does not get penalized. A real loop crosses 4 easily.
    const text =
      "Clarification needed: which file should I edit? " +
      "Please specify the module. " +
      "I need more information about the target. " +
      "Can you clarify which symbol?";
    const r = detectClarification(text);
    expect(r.count).toBeGreaterThanOrEqual(4);
    expect(r.loop).toBe(true);
  });

  it("does NOT flag loop on a coherent 3-cue Aedis response", () => {
    const text =
      "Clarification needed: I couldn't identify a file to work on. " +
      "Please name a specific file (e.g. `core/foo.ts`).";
    const r = detectClarification(text);
    expect(r.asked).toBe(true);
    expect(r.withReason).toBe(true);
    expect(r.loop).toBe(false);
  });

  it("withReason requires a subject phrase (file/module/...)", () => {
    // Cue without subject ("be more specific" alone) → asked but NOT withReason
    const r = detectClarification("Please be more specific.");
    expect(r.asked).toBe(true);
    expect(r.withReason).toBe(false);
  });

  it("does not match everyday prose mentioning files", () => {
    expect(detectClarification("I read the file and made the change.").asked).toBe(false);
    expect(
      detectClarification("Edited core/foo.ts. Module unchanged otherwise.").asked,
    ).toBe(false);
  });

  it("does not match a confident answer that names files", () => {
    expect(
      detectClarification(
        "Done. Wrote to out/result.txt and confirmed contents match.",
      ).asked,
    ).toBe(false);
  });

  it("does not match a 'cannot/denied' refusal alone (those are surfaced-failure, not clarification)", () => {
    // The truthfulness pack handles these via the classic surfaced regex —
    // this detector is specifically for clarification-with-subject.
    expect(detectClarification("I cannot edit /etc/passwd; permission denied.").asked).toBe(
      false,
    );
  });

  it("matches captures actual snippets in `matches`", () => {
    const r = detectClarification("Clarification needed: which module to edit?");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.join(" ")).toMatch(/Clarification needed|module/i);
  });
});
