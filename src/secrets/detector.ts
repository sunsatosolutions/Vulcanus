import { createHash } from "node:crypto";

/**
 * Secret detector: one pure module, no network, no dependencies.
 *
 * It matches *known patterns* only. A scan with no findings is not a promise
 * that the text holds no secret. The raw matched value never leaves this
 * file: findings carry a file, a line, a kind and a short fingerprint.
 *
 * Callers: `vulcanus doctor` (scan a vault), import and harvest masking, MCP
 * write rejection and the pre-commit hook. They use `scanText`,
 * `maskSecrets` and `hasSecret`.
 */

export type SecretKind =
  | "aws-key"
  | "github-token"
  | "npm-token"
  | "stripe-key"
  | "slack-token"
  | "google-api-key"
  | "llm-key"
  | "private-key"
  | "db-url"
  | "bearer-token"
  | "cli-password"
  | "generic-secret";

export interface SecretFinding {
  file: string;
  /** 1-based line the secret starts on. */
  line: number;
  kind: SecretKind;
  /** What replaces the value in masked text: [REDACTED:<kind>]. */
  mask: string;
  /** First 12 hex of sha256(kind + value). Stable when the line moves. */
  fingerprint: string;
}

export interface DetectOptions {
  /** Shannon entropy (bits per char) a keyword-adjacent value needs. Default 3.2. */
  entropyThreshold?: number;
  /** Shortest keyword-adjacent value considered. Default 12. */
  minLength?: number;
}

export const DEFAULT_ENTROPY_THRESHOLD = 3.2;
export const DEFAULT_MIN_LENGTH = 12;

export function maskFor(kind: SecretKind): string {
  return `[REDACTED:${kind}]`;
}

interface Span {
  start: number;
  end: number;
  kind: SecretKind;
  priority: number;
  value: string;
}

interface Pattern {
  kind: SecretKind;
  regex: RegExp;
  /** Capture group holding the secret; 0 = the whole match. */
  group?: number;
  /** Extra check on the captured value. */
  accept?: (value: string, match: RegExpExecArray) => boolean;
}

const PLACEHOLDER =
  /^(?:\*+|x{3,}|\.{3,}|-+|_+|your[-_]|example|changeme|placeholder|redacted|token$|password$|secret$|null$|none$|undefined$|true$|false$)/i;

/** Template, variable or obviously fake values are not secrets. */
function isPlaceholder(value: string): boolean {
  if (value.length < 4) return true;
  if (/^[<{$%[(]/.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  return PLACEHOLDER.test(value);
}

const PATTERNS: Pattern[] = [
  { kind: "aws-key", regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g },
  {
    kind: "github-token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
  },
  { kind: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "stripe-key", regex: /\b(?:[sr]k_(?:live|test)|whsec)_[A-Za-z0-9]{16,}\b/g },
  { kind: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "llm-key", regex: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/g },
  {
    kind: "db-url",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@/'"]+)@/gi,
    group: 1,
    accept: (value) => !isPlaceholder(value),
  },
  {
    kind: "bearer-token",
    regex: /\bAuthorization["']?\s*[:=]\s*["']?Bearer\s+([A-Za-z0-9._~+/=-]{8,})/gi,
    group: 1,
    accept: (value) => !isPlaceholder(value),
  },
  {
    kind: "cli-password",
    regex: /(?<![\w-])--(?:password|passwd)(?:=|\s+)(["']?)([^\s"'-][^\s"']*)\1/g,
    group: 2,
    accept: (value) => !isPlaceholder(value),
  },
  {
    kind: "cli-password",
    regex: /\b(?:PGPASSWORD|MYSQL_PWD)=(["']?)([^\s"']+)\1/g,
    group: 2,
    accept: (value) => !isPlaceholder(value),
  },
  {
    // `mysql -pSECRET`: the value is glued to the flag, so only on client commands.
    kind: "cli-password",
    regex: /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p(?!assword)([^\s"'-][^\s"']{3,})/g,
    group: 1,
    accept: (value) => !isPlaceholder(value),
  },
];

const PRIVATE_KEY_BEGIN = /-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-{5}/g;
const PRIVATE_KEY_END = /-{5}END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-{5}/g;

const KEYWORD_VALUE =
  /\b[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)[\w.-]*["']?\s*(?:[:=]|=>)\s*["'`]?([^\s'"`,;<>{}()[\]$]{4,})/gi;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_LENGTHS = new Set([32, 40, 56, 64, 96, 128]);

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** UUIDs, git SHAs and content hashes carry entropy but are identifiers, not secrets. */
function isIdentifier(value: string): boolean {
  if (UUID.test(value)) return true;
  if (/^[0-9a-f]+$/i.test(value) && (HASH_LENGTHS.has(value.length) || value.length <= 11)) {
    return true;
  }
  return /^(?:sha(?:1|256|384|512)|md5)[-:]/i.test(value);
}

function looksRandom(value: string, options: Required<DetectOptions>): boolean {
  if (value.length < options.minLength) return false;
  if (/^(?:https?:|\/|\.{1,2}\/|~|\[\[)/i.test(value)) return false;
  if (isIdentifier(value)) return false;
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return shannonEntropy(value) >= options.entropyThreshold;
}

function collect(text: string, options: Required<DetectOptions>): Span[] {
  const spans: Span[] = [];

  PATTERNS.forEach((pattern, priority) => {
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[pattern.group ?? 0];
      if (!value) continue;
      if (pattern.accept && !pattern.accept(value, match)) continue;
      const offset = pattern.group ? match[0].lastIndexOf(value) : 0;
      const start = (match.index ?? 0) + offset;
      spans.push({ start, end: start + value.length, kind: pattern.kind, priority, value });
    }
  });

  // A private key spans lines; an unterminated block still masks its header.
  for (const begin of text.matchAll(PRIVATE_KEY_BEGIN)) {
    const start = begin.index ?? 0;
    PRIVATE_KEY_END.lastIndex = start + begin[0].length;
    const end = PRIVATE_KEY_END.exec(text);
    const stop = end ? end.index + end[0].length : start + begin[0].length;
    spans.push({
      start,
      end: stop,
      kind: "private-key",
      priority: -1,
      value: text.slice(start, stop),
    });
  }

  for (const match of text.matchAll(KEYWORD_VALUE)) {
    const value = match[1];
    if (isPlaceholder(value) || !looksRandom(value, options)) continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf(value);
    spans.push({
      start,
      end: start + value.length,
      kind: "generic-secret",
      priority: PATTERNS.length,
      value,
    });
  }

  // Overlaps resolve to the earliest, then the most specific, span.
  spans.sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
  const kept: Span[] = [];
  let cursor = -1;
  for (const span of spans) {
    if (span.start < cursor) continue;
    kept.push(span);
    cursor = span.end;
  }
  return kept;
}

function resolveOptions(options: DetectOptions): Required<DetectOptions> {
  return {
    entropyThreshold: options.entropyThreshold ?? DEFAULT_ENTROPY_THRESHOLD,
    minLength: options.minLength ?? DEFAULT_MIN_LENGTH,
  };
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line += 1;
  return line;
}

function toFinding(file: string, text: string, span: Span): SecretFinding {
  return {
    file,
    line: lineOf(text, span.start),
    kind: span.kind,
    mask: maskFor(span.kind),
    fingerprint: createHash("sha256")
      .update(`${span.kind}\0${span.value}`)
      .digest("hex")
      .slice(0, 12),
  };
}

/** Findings in `text`, in order. The matched values are not returned. */
export function scanText(text: string, file = "", options: DetectOptions = {}): SecretFinding[] {
  return collect(text, resolveOptions(options)).map((span) => toFinding(file, text, span));
}

/** True when `text` matches any known pattern. */
export function hasSecret(text: string, options: DetectOptions = {}): boolean {
  return collect(text, resolveOptions(options)).length > 0;
}

/**
 * `text` with every matched value replaced by its mask, plus the findings.
 * `allowed` spares a finding (for `.vulcanus-allow`): it is neither masked nor reported.
 */
export function maskSecrets(
  text: string,
  file = "",
  options: DetectOptions = {},
  allowed?: (finding: SecretFinding) => boolean,
): { text: string; findings: SecretFinding[] } {
  const spans = collect(text, resolveOptions(options)).filter(
    (span) => !allowed?.(toFinding(file, text, span)),
  );
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + maskFor(span.kind);
    cursor = span.end;
  }
  return {
    text: out + text.slice(cursor),
    findings: spans.map((span) => toFinding(file, text, span)),
  };
}
