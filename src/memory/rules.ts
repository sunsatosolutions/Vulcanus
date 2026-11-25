import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Problem } from "../errors.js";
import { headingVariants } from "../generate/text.js";
import { buildPlan } from "../manifest/derive.js";
import type { VaultManifest } from "../manifest/schema.js";
import type { Locale } from "../i18n.js";
import { expandHome } from "../util/paths.js";
import { extractClaims, findDrift } from "./drift.js";
import { parseSections, stripComments } from "./lifecycle.js";

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

/** Capsule sections whose bullets are the rules an agent in the code repository needs. */
export const RULE_SECTIONS = ["Must Remember", "Do Not Assume"];

export function capsuleRules(text: string, path: string, language: Locale): string[] {
  const lines = stripComments(text).split("\n");
  const wanted = new Set(RULE_SECTIONS.flatMap((name) => headingVariants(name, language)));
  const rules: string[] = [];
  for (const section of parseSections(path, text)) {
    if (!wanted.has(`## ${section.heading}`)) continue;
    let fence: string | null = null;
    // open: inside a bullet; gap: a blank line or fence came since the last rule line.
    let open = false;
    let gap = false;
    for (const line of lines.slice(section.line, section.endLine)) {
      const fenceMatch = /^\s*(```|~~~)/.exec(line);
      if (fenceMatch) {
        if (fence === null) fence = fenceMatch[1];
        else if (fenceMatch[1] === fence) fence = null;
        gap = true;
        continue;
      }
      if (fence !== null) continue;
      if (line.trim() === "") {
        gap = true;
        continue;
      }
      // A bullet's wrapped lines belong to the rule, even after a blank line or
      // an example, while they stay indented; an unindented paragraph ends it.
      if (/^\s*[-*]\s+\S/.test(line)) open = true;
      else if (!open || (gap && !/^\s/.test(line))) {
        open = false;
        continue;
      }
      gap = false;
      // Wikilinks mean nothing outside the vault: keep the label.
      rules.push(
        line
          .trimEnd()
          .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
          .replace(/\[\[([^\]#]*)[^\]]*\]\]/g, "$1"),
      );
    }
  }
  return rules;
}

export async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface LinkChange {
  file: string;
  action: "create" | "update" | "unchanged";
  before: string[];
  after: string[];
}

export type LinkPlan =
  | { ok: true; project: string; root: string; changes: LinkChange[]; next: Map<string, string> }
  | { ok: false; problem: Problem };

/** What `rules link` would write into `root` for one project, with nothing written. */
export async function planLink(
  vaultRoot: string,
  manifest: VaultManifest,
  projectId: string,
  root: string,
): Promise<LinkPlan> {
  const plan = buildPlan(manifest).allProjects.find((entry) => entry.project.id === projectId)!;
  const capsule = plan.capsule;
  const capsuleText = await readOrNull(resolve(vaultRoot, capsule.path));
  if (capsuleText === null) {
    return {
      ok: false,
      problem: {
        what: `${capsule.path} does not exist.`,
        why: "The rules are read from the project's Capsule.",
        fix: "vulcanus doctor --repair",
      },
    };
  }
  const rules = capsuleRules(capsuleText, capsule.path, manifest.vault.language);
  if (rules.length === 0) {
    return {
      ok: false,
      problem: {
        what: `${capsule.path} has no bullets under ${RULE_SECTIONS.join(" or ")}.`,
        why: "There is nothing to write into the code repository.",
        fix: "Add the rules as bullets in the Capsule.",
      },
    };
  }
  const block = renderBlock(`${plan.project.name} rules`, rules);
  const changes: LinkChange[] = [];
  const next = new Map<string, string>();
  for (const file of RULE_FILES) {
    const existing = await readOrNull(resolve(root, file));
    const read = existing === null ? null : readBlock(existing);
    if (read?.kind === "broken") {
      return {
        ok: false,
        problem: {
          what: `${file} has a damaged vulcanus rules block.`,
          why: "Writing would have to guess where the block ends, and your text sits around it.",
          fix: "Fix or remove the start and end markers by hand, then run the command again.",
        },
      };
    }
    const text = applyBlock(existing, block, file);
    changes.push({
      file,
      action: existing === null ? "create" : text === existing ? "unchanged" : "update",
      before: read?.kind === "ok" ? read.body.split(/\r?\n/) : [],
      after: block.split("\n"),
    });
    next.set(file, text);
  }
  return { ok: true, project: plan.project.name, root, changes, next };
}

export interface LinkedRepo {
  id: string;
  name: string;
  root: string;
}

/**
 * Code repositories already tied to the vault: a project's manifest `root` that
 * is a folder holding at least one rules block. Linking is opt-in, so a root
 * without a block is left alone.
 */
export async function linkedRepos(
  vaultRoot: string,
  manifest: VaultManifest,
): Promise<LinkedRepo[]> {
  const repos: LinkedRepo[] = [];
  for (const { project } of buildPlan(manifest).allProjects) {
    if (typeof project.root !== "string") continue;
    const root = resolve(vaultRoot, expandHome(project.root));
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const file of RULE_FILES) {
      const text = await readOrNull(resolve(root, file));
      if (text !== null && readBlock(text).kind !== "none") {
        repos.push({ id: project.id, name: project.name, root });
        break;
      }
    }
  }
  return repos;
}

/** Check one repository by reading its rule files. */
export async function checkRepo(root: string): Promise<RulesReport | null> {
  const texts = new Map<string, string | null>();
  for (const file of RULE_FILES) texts.set(file, await readOrNull(resolve(root, file)));
  return checkRules(root, texts);
}
