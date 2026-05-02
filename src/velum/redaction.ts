/**
 * Secret redaction. Used by Velum and by receipt writers.
 *
 * Important property: redaction NEVER hides the fact that a leak happened.
 * It rewrites the secret bytes for storage but the redaction event itself
 * is preserved in the receipt as evidence.
 */

export interface SecretMatch {
  kind: string;
  start: number;
  end: number;
  preview: string;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "anthropic_api_key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai_api_key", re: /sk-[A-Za-z0-9]{20,}/g },
  { kind: "aws_access_key_id", re: /AKIA[0-9A-Z]{16}/g },
  { kind: "aws_secret_access_key", re: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g },
  { kind: "github_token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: "google_api_key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { kind: "slack_token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "private_key_block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END[^-]*-----/g },
  { kind: "jwt", re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "dotenv_assignment", re: /(?:^|\n)\s*(?:[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*[^\n]{6,}/g },
];

export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        kind,
        start: m.index,
        end: m.index + m[0].length,
        preview: m[0].slice(0, 6) + "…" + m[0].slice(-4),
      });
    }
  }
  return matches;
}

export function redact(text: string): { redacted: string; matches: SecretMatch[] } {
  const matches = findSecrets(text);
  if (matches.length === 0) return { redacted: text, matches: [] };
  // sort and replace from the end so indexes stay valid
  matches.sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of matches) {
    out = out.slice(0, m.start) + `[REDACTED:${m.kind}]` + out.slice(m.end);
  }
  // restore ascending order for callers
  matches.sort((a, b) => a.start - b.start);
  return { redacted: out, matches };
}
