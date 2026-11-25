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

interface AlignOp {
  kind: "missing" | "extra";
  index: number;
}

/** Last row of LCS lengths of a[aLo..aHi) against every prefix of b[bLo..bHi); O(b) memory. */
function lcsRow(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
  reverse: boolean,
): number[] {
  const width = bHi - bLo;
  let prev = new Array<number>(width + 1).fill(0);
  let cur = new Array<number>(width + 1).fill(0);
  for (let k = 0; k < aHi - aLo; k++) {
    const x = a[reverse ? aHi - 1 - k : aLo + k];
    for (let j = 1; j <= width; j++) {
      const y = b[reverse ? bHi - j : bLo + j - 1];
      cur[j] = x === y ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev;
}

/**
 * Lines of `want` absent from `have` ("missing") and lines of `have` absent
 * from `want` ("extra"), in order. Hirschberg's linear-memory LCS, so a large
 * block does not allocate an n*m table.
 */
function align(want: string[], have: string[]): AlignOp[] {
  const ops: AlignOp[] = [];
  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && want[aLo] === have[bLo]) {
      aLo++;
      bLo++;
    }
    while (aLo < aHi && bLo < bHi && want[aHi - 1] === have[bHi - 1]) {
      aHi--;
      bHi--;
    }
    if (aLo === aHi || bLo === bHi || aHi - aLo === 1) {
      let keep = -1;
      if (aHi - aLo === 1) {
        keep = have.indexOf(want[aLo], bLo);
        if (keep >= bHi) keep = -1;
      }
      if (keep < 0) for (let i = aLo; i < aHi; i++) ops.push({ kind: "missing", index: i });
      for (let j = bLo; j < bHi; j++) if (j !== keep) ops.push({ kind: "extra", index: j });
      return;
    }
    const mid = (aLo + aHi) >> 1;
    const front = lcsRow(want, aLo, mid, have, bLo, bHi, false);
    const back = lcsRow(want, mid, aHi, have, bLo, bHi, true);
    let split = 0;
    let best = -1;
    for (let j = 0; j <= bHi - bLo; j++) {
      const total = front[j] + back[bHi - bLo - j];
      if (total > best) {
        best = total;
        split = j;
      }
    }
    walk(aLo, mid, bLo, bLo + split);
    walk(mid, aHi, bLo + split, bHi);
  };
  walk(0, want.length, 0, have.length);
  return ops;
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
      const ops = align(
        want.map((e) => e.text),
        have.map((e) => e.text),
      );
      for (const op of ops) {
        if (op.kind === "missing") {
          findings.push({
            kind: "divergent",
            file,
            line: block.line,
            text: want[op.index].text,
            reason: `in ${reference} but missing here`,
          });
        } else {
          findings.push({
            kind: "divergent",
            file,
            line: have[op.index].line,
            text: have[op.index].text,
            reason: `not in ${reference}`,
          });
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
