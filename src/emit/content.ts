import { headingVariants } from "../generate/text.js";
import type { ProjectPlan } from "../manifest/derive.js";
import type { ProjectNode, VaultManifest } from "../manifest/schema.js";
import {
  LIFECYCLE_KEYS,
  fenceAfter,
  parseSections,
  sectionState,
  stripComments,
} from "../memory/lifecycle.js";
import { plainLinks } from "../memory/rules.js";

const HOMOGLYPHS: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
};

function codePoint(n: number, fallback: string): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;
}

/** Letters and digits only, as a reader sees them with markup, escapes and look-alikes set aside. */
function squash(raw: string, bare = false): string {
  let text = raw;
  try {
    text = decodeURIComponent(text);
  } catch {
    text = text.replace(/%[0-9a-f]{2}/gi, " ");
  }
  text = text
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d: string) => codePoint(parseInt(d, 10), m))
    .replace(/&[a-z][a-z0-9]*;/gi, " ")
    .replace(bare ? /<[^>]*>|\]\([^)]*\)|\]\[[^\]]*\]/g : /(?!)/g, " ");
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0400-\u04ff]/g, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/[^a-z0-9]/g, "");
}

/** Words of a line, each folded the way `squash` folds. */
function words(raw: string): Set<string> {
  const parts = raw.split(/[\s\u2028\u2029_-]+/);
  return new Set(parts.map((word) => squash(word)).filter(Boolean));
}

/** Whether `project` is private, or sits under a private project. */
export function isPrivate(manifest: VaultManifest, project: ProjectNode): boolean {
  const seen = new Set<string>();
  let node: ProjectNode | undefined = project;
  while (node && !seen.has(node.id)) {
    if (node.visibility === "private") return true;
    seen.add(node.id);
    const parent: string | null = node.parent;
    node = parent ? manifest.projects.find((entry) => entry.id === parent) : undefined;
  }
  return false;
}

const LIFECYCLE_LINE = new RegExp(`^\\s*(?:${LIFECYCLE_KEYS.join("|")})::`);

export interface ContentOptions {
  /** Vault-relative path to note text, as `loadVaultNotes` returns it. */
  notes: ReadonlyMap<string, string>;
  manifest: VaultManifest;
  plan: ProjectPlan;
  /** ISO date that decides what has expired. */
  on: string;
  includePrivate: boolean;
}

/**
 * The project's Capsule and Rules sections that are still true, as Markdown;
 * null when none is. A section that is superseded or past `valid-until` is left out
 * (the same `sectionState` `doctor` uses), and so is anything that names a private
 * project, unless the operator asked for it.
 */
export function projectContent(options: ContentOptions): string | null {
  const { notes, manifest, plan, on, includePrivate } = options;
  const language = manifest.vault.language;
  const skip = new Set(headingVariants("Read Next", language));
  const hiddenNames = includePrivate
    ? []
    : manifest.projects
        .filter((project) => project.id !== plan.project.id && isPrivate(manifest, project))
        .flatMap((project) => [
          project.name,
          project.id,
          project.dirName ?? "",
          ...project.triggers,
        ]);
  const hidden = [...new Set(hiddenNames.map((word) => squash(word)).filter(Boolean))];
  const hiddenWords = hiddenNames.map((name) => [...words(name)]).filter((list) => list.length > 1);

  /** Indexes of the lines that name a hidden project, also when the name wraps onto the next line. */
  const leakedLines = (lines: string[]): Set<number> => {
    const found = new Set<number>();
    if (hidden.length === 0) return found;
    let flat = "";
    let bare = "";
    const owner: number[] = [];
    const bareOwner: number[] = [];
    lines.forEach((line, index) => {
      const piece = squash(line);
      flat += piece;
      bare += squash(line, true);
      for (let i = 0; i < piece.length; i++) owner.push(index);
      for (let i = 0; i < squash(line, true).length; i++) bareOwner.push(index);
      const tokens = words(line);
      if (hiddenWords.some((list) => list.every((word) => tokens.has(word)))) found.add(index);
    });
    for (const [text, rows] of [
      [flat, owner],
      [bare, bareOwner],
    ] as const) {
      for (const name of hidden) {
        for (const needle of [name, [...name].reverse().join("")]) {
          for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
            for (let i = at; i < at + needle.length; i++) found.add(rows[i]);
          }
        }
      }
    }
    return found;
  };
  const leaks = (text: string) => leakedLines([text]).size > 0;

  const out: string[] = [];
  for (const path of [plan.capsule.path, plan.rules.path]) {
    const text = notes.get(path);
    if (text === undefined) continue;
    const lines = stripComments(text).split("\n");
    for (const section of parseSections(path, text)) {
      if (sectionState(section, on) !== "live") continue;
      if (skip.has(`## ${section.heading}`) || leaks(section.heading)) continue;

      let fence: string | null = null;
      const body: string[] = [];
      const sectionLines = lines.slice(section.line, section.endLine);
      const leaked = leakedLines(sectionLines);
      for (const [index, line] of sectionLines.entries()) {
        const step = fenceAfter(fence, line);
        fence = step.fence;
        const inCode = step.isFence || fence !== null;
        if (!inCode && LIFECYCLE_LINE.test(line)) continue;
        // Checked on the raw line: a wikilink alias would hide the target name,
        // and a code block is copied as it is.
        if (leaked.has(index)) {
          if (step.isFence) body.push(/^\s*(?:`{3,}|~{3,})/.exec(line)?.[0] ?? "```");
          continue;
        }
        body.push(plainLinks(line.trimEnd()));
      }
      while (body.length && body[0] === "") body.shift();
      while (body.length && body[body.length - 1] === "") body.pop();
      if (body.length === 0) continue;
      out.push(`### ${plainLinks(section.heading)}`, "", ...body, "");
    }
  }
  if (out.length === 0) return null;
  return [`## ${plan.project.name}`, "", ...out].join("\n").trimEnd();
}
