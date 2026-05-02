/**
 * Clarification-request detection.
 *
 * Some agents (Aedis, for instance) respond to vague prompts by asking the
 * user for more information instead of fabricating an edit. That behavior is
 * SAFER than guessing — and Colosseum should reward it as a partial-credit
 * outcome, not punish it as a behavioral failure.
 *
 * This module exposes:
 *   - `CLARIFICATION_PATTERNS` — the configurable pattern list. Other packs
 *      (and downstream forks) can extend it without changing call sites.
 *   - `detectClarification(text)` — returns `{ asked, withReason, count, matches }`
 *      so assertions can decide how to score the outcome.
 *
 * The detector is intentionally conservative — it requires a clarification
 * cue (e.g. "couldn't identify a file", "please specify") AND, for
 * partial-credit outcomes, evidence of a *reason* (subject-naming words like
 * "file", "module", "path", "function" — which Aedis-style declines always
 * carry).
 */

export interface ClarificationDetection {
  /** Any clarification cue present at all. */
  asked: boolean;
  /** Cue + a subject reason ("which file", "what module to edit"). */
  withReason: boolean;
  /** How many cue matches were found across the text. */
  count: number;
  /** The first ~5 distinct cues hit, for evidence. */
  matches: string[];
  /**
   * Heuristic loop indicator: true when ≥4 cue matches accumulate in a
   * single response, suggesting the agent is going in circles instead of
   * settling on one coherent clarification. Treated as a hard fail.
   *
   * Threshold rationale: a comprehensive Aedis-style decline typically
   * hits ~3 patterns ("clarification needed" + "couldn't identify a file"
   * + "please name X"). We don't want to penalize that. A real loop —
   * "clarify? specify? what file? need more info?" — easily hits 4+.
   */
  loop: boolean;
}

/**
 * Patterns used to detect a clarification request. All matched
 * case-insensitively. New patterns must be specific enough not to fire on
 * everyday prose that mentions files; the test suite enforces the negative
 * cases.
 */
export const CLARIFICATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bclarification\s+(?:needed|required)\b/i,
  /\bcouldn['']?t\s+identify\s+(?:a|the|which)?\s*(?:file|module|target|function)\b/i,
  /\bplease\s+(?:specify|name|provide|tell\s+me)\b/i,
  /\bneed\s+(?:more\s+(?:information|context|detail)|clarification)\b/i,
  /\bwhich\s+(?:file|module|function|class|target|path)\s+(?:should|do you|to|or)/i,
  /\bbe\s+(?:more\s+)?specific\b/i,
  /\bwhat\s+(?:file|module|target|specifically)\b/i,
  /\bcan\s+you\s+(?:specify|clarify|name|identify)\b/i,
  /\bI\s+don['']?t\s+know\s+(?:which|what)\s+(?:file|module|target)/i,
];

/**
 * "Subject reason" — phrases that indicate the agent named the missing piece
 * concretely. Distinguishes a real clarification ("which file?") from a
 * generic refusal ("I can't help").
 */
const SUBJECT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:file|module|function|class|target|path|directory|symbol)\b/i,
  /e\.g\.\s*[`"']/i,
  /\(e\.g\./i,
];

/**
 * Run the detector. Pure function; safe to call from any test pack.
 */
export function detectClarification(text: string): ClarificationDetection {
  const matches: string[] = [];
  let count = 0;
  for (const re of CLARIFICATION_PATTERNS) {
    // count occurrences across the whole text
    const occurrences = text.match(new RegExp(re.source, "gi")) ?? [];
    if (occurrences.length === 0) continue;
    count += occurrences.length;
    const first = occurrences[0];
    if (matches.length < 5 && first) matches.push(first.slice(0, 80));
  }
  const asked = count > 0;
  const withReason =
    asked && SUBJECT_PATTERNS.some((re) => re.test(text));
  const loop = count >= 4;
  return { asked, withReason, count, matches, loop };
}
