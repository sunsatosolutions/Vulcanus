import { extractClaims, findDrift } from "./drift.js";

/**
 * Rules shared with a code repository: one managed block, kept identical in
 * every agent file. The block is the only thing `rules link` ever rewrites;
 * `rules check` compares the copies and the claims they make against the code.
 */

export const START = "<!-- vulcanus:rules:start -->";
export const END = "<!-- vulcanus:rules:end -->";

/** The agent files that carry the block, in the order `check` trusts them. */
export const RULE_FILES = ["AGENTS.md", "CLAUDE.md", ".cursor/rules/vault.mdc"] as const;

export type BlockRead =
  | { kind: "none" }
  | { kind: "broken"; reason: string }
  | {
      kind: "ok";
      /** Offset of the start marker, and just past the end marker. */
      from: number;
      to: number;
      body: string;
      /** 1-indexed file line of the first body line. */
      line: number;
    };

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

export function readBlock(text: string): BlockRead {
  const starts = countOf(text, START);
  const ends = countOf(text, END);
  if (starts === 0 && ends === 0) return { kind: "none" };
  if (starts !== 1 || ends !== 1) {
    return { kind: "broken", reason: `${starts} start and ${ends} end markers; expected one each` };
  }
  const from = text.indexOf(START);
  const end = text.indexOf(END);
  if (end < from) return { kind: "broken", reason: "the end marker comes before the start marker" };
  const body = text
    .slice(from + START.length, end)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");
  const line = text.slice(0, from + START.length).split("\n").length + 1;
  return { kind: "ok", from, to: end + END.length, body, line };
}

export function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function renderBlock(title: string, rules: string[], eol = "\n"): string {
  return [START, `## ${title}`, "", ...rules, END].join(eol);
}

/**
 * The file with the block in place. Bytes outside the markers are carried over
 * untouched; a file without a block gets it appended, a missing one is created.
 */
export function applyBlock(existing: string | null, block: string, file: string): string {
  if (existing === null) {
    const head = file.endsWith(".mdc")
      ? "---\ndescription: Project rules from the vault\nalwaysApply: true\n---\n\n"
      : "";
    return `${head}${block}\n`;
  }
  const eol = eolOf(existing);
  const text = eol === "\n" ? block : block.replace(/\n/g, eol);
  const read = readBlock(existing);
  if (read.kind === "ok") return existing.slice(0, read.from) + text + existing.slice(read.to);
  const gap = existing === "" ? "" : existing.endsWith("\n") ? eol : eol + eol;
  return `${existing}${gap}${text}${eol}`;
}

export type RuleFindingKind = "missing-block" | "broken-block" | "divergent" | "path" | "script";

export interface RuleFinding {
  kind: RuleFindingKind;
  file: string;
  /** 1-indexed line in `file`; 0 when the file or block is absent. */
  line: number;
  text: string;
  reason: string;
}

export interface RuleFileState {
  path: string;
  state: "ok" | "missing-file" | "no-block" | "broken";
}

export interface RulesReport {
  root: string;
  ok: boolean;
  files: RuleFileState[];
  claimsChecked: number;
  findings: RuleFinding[];
}

interface Entry {
  text: string;
  line: number;
}

function entries(body: string, firstLine: number): Entry[] {
  return body
    .split(/\r?\n/)
    .map((raw, index) => ({ text: raw.trimEnd(), line: firstLine + index }))
    .filter((entry) => entry.text !== "");
}

/**
 * `texts` maps each rule file to its content, or null when the file is absent.
 * Returns null when no file holds a block: there is nothing to check.
 */
export function checkRules(root: string, texts: Map<string, string | null>): RulesReport | null {
  const files: RuleFileState[] = [];
  const findings: RuleFinding[] = [];
  const blocks = new Map<string, Extract<BlockRead, { kind: "ok" }>>();

  for (const file of RULE_FILES) {
    const text = texts.get(file) ?? null;
    if (text === null) {
      files.push({ path: file, state: "missing-file" });
      continue;
    }
    const read = readBlock(text);
    if (read.kind === "ok") {
      blocks.set(file, read);
      files.push({ path: file, state: "ok" });
    } else {
      files.push({ path: file, state: read.kind === "none" ? "no-block" : "broken" });
    }
  }
  if (blocks.size === 0 && files.every((file) => file.state !== "broken")) return null;

  for (const state of files) {
    if (state.state === "missing-file" || state.state === "no-block") {
      findings.push({
        kind: "missing-block",
        file: state.path,
        line: 0,
        text: state.path,
        reason:
          state.state === "missing-file" ? "the file does not exist" : "no managed rules block",
      });
    } else if (state.state === "broken") {
      const read = readBlock(texts.get(state.path) ?? "");
      findings.push({
        kind: "broken-block",
        file: state.path,
        line: 0,
        text: state.path,
        reason: read.kind === "broken" ? read.reason : "unreadable block",
      });
    }
  }

  const reference = RULE_FILES.find((file) => blocks.has(file));
  if (reference) {
    const want = entries(blocks.get(reference)!.body, blocks.get(reference)!.line);
    for (const [file, block] of blocks) {
      if (file === reference) continue;
      const have = entries(block.body, block.line);
      if (have.length === want.length) {
        have.forEach((entry, index) => {
          if (entry.text !== want[index].text) {
            findings.push({
              kind: "divergent",
              file,
              line: entry.line,
              text: entry.text,
              reason: `differs from ${reference}: ${want[index].text}`,
            });
          }
        });
        continue;
      }
      // Different lengths: align in order (longest common subsequence) so
      // reordered or repeated lines show up; set membership would hide them.
      const n = want.length;
      const m = have.length;
      const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          lcs[i][j] =
            want[i].text === have[j].text
              ? lcs[i + 1][j + 1] + 1
              : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && want[i].text === have[j].text) {
          i++;
          j++;
        } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
          findings.push({
            kind: "divergent",
            file,
            line: block.line,
            text: want[i].text,
            reason: `in ${reference} but missing here`,
          });
          i++;
        } else {
          findings.push({
            kind: "divergent",
            file,
            line: have[j].line,
            text: have[j].text,
            reason: `not in ${reference}`,
          });
          j++;
        }
      }
    }
  }

  let claimsChecked = 0;
  for (const [file, block] of blocks) {
    const claims = extractClaims(block.body);
    claimsChecked += claims.length;
    for (const drift of findDrift(claims, root)) {
      findings.push({
        kind: drift.kind,
        file,
        line: block.line + drift.line - 1,
        text: drift.text,
        reason: drift.reason,
      });
    }
  }

  return { root, ok: findings.length === 0, files, claimsChecked, findings };
}
