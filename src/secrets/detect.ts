import { createHash } from "node:crypto";

export type SecretLevel = "error" | "warning";

export interface SecretRule {
  id: string;
  /** Short name shown in output and in `[REDACTED:<type>]`. */
  type: string;
  level: SecretLevel;
  pattern: RegExp;
  /** Capture group holding the secret itself (the first that matched, if a list); the whole match when absent. */
  group?: number | number[];
  /** Extra check on the secret value; return false to drop the match. */
  accept?: (value: string) => boolean;
}

export interface SecretMatch {
  rule: string;
  type: string;
  level: SecretLevel;
  /** Half-open span of the secret value inside the line. */
  start: number;
  end: number;
  /** sha256 over the rule id and the value; what `.vulcanus-allow` stores. */
  hash: string;
}

/** Shannon entropy in bits per character. */
export function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const PLACEHOLDER = /^(?:[<{$%*[(]|x{3,}|\.{3,}|changeme|password|passwd|pass|secret|example)/i;

const looksSecret = (value: string): boolean =>
  !PLACEHOLDER.test(value) && /[0-9]|[^A-Za-z0-9]/.test(value);

/**
 * Order is priority: when two rules claim overlapping text the earlier one
 * wins, so the entropy rule only sees what no specific rule recognised.
 */
export const RULES: readonly SecretRule[] = [
  {
    id: "openai-key",
    type: "api_key",
    level: "error",
    pattern: /(?<![A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "github-token",
    type: "github_token",
    level: "error",
    pattern:
      /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})(?![A-Za-z0-9_])/g,
  },
  {
    id: "aws-access-key",
    type: "aws_access_key",
    level: "error",
    pattern: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  },
  {
    id: "slack-token",
    type: "slack_token",
    level: "error",
    pattern: /(?<![A-Za-z0-9])xox[bp]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "jwt",
    type: "jwt",
    level: "error",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "bearer",
    type: "bearer_token",
    level: "error",
    pattern: /Authorization:\s*Bearer\s+([A-Za-z0-9._~+/=-]{16,})/gi,
    group: 1,
    accept: looksSecret,
  },
  {
    id: "connection-password",
    type: "connection_password",
    level: "error",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@[^\s/]+/gi,
    group: 1,
    accept: (value) => !PLACEHOLDER.test(value),
  },
  {
    id: "password",
    type: "password",
    level: "error",
    pattern:
      /(?<![A-Za-z0-9])(?:password|passwd|pwd)\s*[=:]\s*(?:"([^"\r\n]{6,})"|'([^'\r\n]{6,})'|["']?([^\s"'<>{}$]{6,}))/gi,
    group: [1, 2, 3],
    accept: looksSecret,
  },
  {
    id: "high-entropy",
    type: "high_entropy",
    level: "warning",
    pattern: /(?<![A-Za-z0-9_+-])[A-Za-z0-9_+-]{32,}(?![A-Za-z0-9_+-])/g,
    accept: (value) =>
      /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && entropy(value) >= 4.3,
  },
];

export function hashSecret(ruleId: string, value: string): string {
  return createHash("sha256").update(`${ruleId}\0${value}`).digest("hex");
}

/** Every secret in one line, in line order; matches may overlap, none lies inside another. Values are never returned. */
export function detectLine(line: string): SecretMatch[] {
  const taken: SecretMatch[] = [];
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("d", "")}d`);
    for (const match of line.matchAll(pattern)) {
      const groups = [rule.group ?? 0].flat();
      const span = groups.map((g) => match.indices?.[g]).find(Boolean);
      if (!span) continue;
      const [start, end] = span;
      const value = line.slice(start, end);
      if (rule.accept && !rule.accept(value)) continue;
      // Only a match inside an earlier one is dropped; a wider or partly overlapping one stays so `--fix` masks the whole span.
      if (taken.some((other) => other.start <= start && end <= other.end)) continue;
      taken.push({
        rule: rule.id,
        type: rule.type,
        level: rule.level,
        start,
        end,
        hash: hashSecret(rule.id, value),
      });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}
