/**
 * Decision lifecycle: which recorded decisions and rules are still true.
 *
 * A correction used to be prose — a new section appended under the old one,
 * with nothing machine-checkable connecting the two. Lifecycle fields make it
 * a link instead:
 *
 *   ## Usage-Based Pricing
 *
 *   supersedes:: [[Acme Decisions#Flat Pricing]]
 *
 * The old section is never deleted or rewritten; superseding only adds fields
 * under its heading, so history stays readable. Keys are fixed English tokens
 * in every vault language, like the agent protocol: they are machine fields,
 * and translating them would make a vault unparseable when its language
 * changes.
 *
 * Everything here is pure string and date logic, so doctor, repair, and the
 * MCP tools share one reading of a note.
 */

export const LIFECYCLE_KEYS = [
  "supersedes",
  "superseded-by",
  "superseded-on",
  "valid-until",
  "source",
] as const;

export type LifecycleKey = (typeof LIFECYCLE_KEYS)[number];

export type LifecycleState = "live" | "superseded" | "expired";

export interface LinkRef {
  /** The link as written, brackets included. */
  raw: string;
  /** Note part of the link; empty for a same-note `[[#Heading]]` link. */
  note: string;
  /** Heading part of the link; empty when the link names a whole note. */
  heading: string;
}

export interface MemorySection {
  /** Vault-relative path of the note holding the section. */
  path: string;
  /** The `## ` heading text, verbatim. */
  heading: string;
  /** 1-indexed line of the heading. */
  line: number;
  /** 1-indexed last line belonging to the section. */
  endLine: number;
  supersedes: LinkRef[];
  supersededBy: LinkRef[];
  supersededOn?: string;
  validUntil?: string;
  source?: string;
  /** Field values that should be ISO dates and are not, as `key:: value`. */
  badDates: string[];
}

const FIELD = /^\s*(supersedes|superseded-by|superseded-on|valid-until|source)::[ \t]*(.*)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The operator's calendar date, not UTC's: a decision recorded after midnight
 * in Istanbul is dated the day it was made there.
 */
export function today(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Compare headings the way a reader would: case, spacing, and the characters
 * a wikilink cannot carry (`[ ] | # ^`) do not make two headings different.
 */
export function headingKey(heading: string): string {
  return heading
    .normalize("NFC")
    .replace(/[[\]|#^]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseLinks(value: string): LinkRef[] {
  const links: LinkRef[] = [];
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const target = match[1].split("|")[0];
    const hash = target.indexOf("#");
    const note = (hash === -1 ? target : target.slice(0, hash)).trim().normalize("NFC");
    const heading = hash === -1 ? "" : target.slice(hash + 1).trim();
    links.push({ raw: match[0], note, heading });
  }
  return links;
}

/**
 * Every `## ` section of a note with its lifecycle fields. Fields inside code
 * fences and HTML comments are ignored, the same way wikilinks there are.
 */
export function parseSections(path: string, text: string): MemorySection[] {
  const lines = text.split(/\r?\n/);
  const sections: MemorySection[] = [];
  let current: MemorySection | null = null;
  let fence: string | null = null;
  let inComment = false;

  const close = (endLine: number) => {
    if (current) {
      current.endLine = endLine;
      sections.push(current);
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (inComment) {
      if (trimmed.includes("-->")) inComment = false;
      return;
    }
    const fenceMatch = /^(```|~~~)/.exec(trimmed);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      inComment = true;
      return;
    }

    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith("###")) {
      close(index);
      current = {
        path,
        heading: heading[1],
        line: index + 1,
        endLine: index + 1,
        supersedes: [],
        supersededBy: [],
        badDates: [],
      };
      return;
    }
    if (/^#\s/.test(line)) {
      // A top-level title ends the previous section without opening a new one.
      close(index);
      current = null;
      return;
    }
    if (!current) return;

    const field = FIELD.exec(line);
    if (!field) return;
    const key = field[1] as LifecycleKey;
    const value = field[2].trim();
    if (key === "supersedes") current.supersedes.push(...parseLinks(value));
    else if (key === "superseded-by") current.supersededBy.push(...parseLinks(value));
    else if (key === "source") current.source = value;
    else {
      if (!isIsoDate(value)) current.badDates.push(`${key}:: ${value}`);
      else if (key === "superseded-on") current.supersededOn = value;
      else current.validUntil = value;
    }
  });
  close(lines.length);

  return sections;
}

export function sectionState(section: MemorySection, on: string = today()): LifecycleState {
  if (section.supersededBy.length > 0) return "superseded";
  if (section.validUntil && section.validUntil < on) return "expired";
  return "live";
}

/** The section a 1-indexed line falls in, if any. */
export function sectionAt(sections: MemorySection[], line: number): MemorySection | undefined {
  return sections.find((section) => line >= section.line && line <= section.endLine);
}

export function findSection(sections: MemorySection[], heading: string): MemorySection | undefined {
  const key = headingKey(heading);
  return sections.find((section) => headingKey(section.heading) === key);
}

/** A heading link in the form doctor and Obsidian both resolve. */
export function headingLink(noteName: string, heading: string): string {
  return `[[${noteName}#${heading.replace(/[[\]|#^]/g, "").trim()}]]`;
}

/**
 * Insert field lines directly under a section's heading, after any fields
 * already there. Nothing else in the note moves. Returns null when the heading
 * is not in the note.
 */
export function insertFields(text: string, heading: string, fields: string[]): string | null {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const section = findSection(parseSections("", text), heading);
  if (!section) return null;

  const lines = text.split(/\r?\n/);
  let at = section.line; // index just after the heading line
  // Skip the blank line under the heading and any field block already there.
  let cursor = at;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  let lastField = -1;
  while (cursor < lines.length && FIELD.test(lines[cursor])) {
    lastField = cursor;
    cursor += 1;
  }

  if (lastField !== -1) {
    at = lastField + 1;
    lines.splice(at, 0, ...fields);
  } else {
    const blankFollows = at < lines.length && lines[at].trim() === "";
    lines.splice(at, 0, "", ...fields, ...(blankFollows ? [] : [""]));
  }
  return lines.join(newline);
}

// --- Vault-wide analysis -----------------------------------------------------

export interface LifecycleIssue {
  level: "error" | "warning";
  code: "LIFECYCLE" | "EXPIRED" | "STALE-REF";
  message: string;
  file: string;
}

/** A back-reference `doctor --repair` can add without a human decision. */
export interface MissingBackLink {
  /** Note to patch. */
  path: string;
  /** Section in that note to patch. */
  heading: string;
  /** Field lines to insert. */
  fields: string[];
}

export interface LifecycleAnalysis {
  issues: LifecycleIssue[];
  missingBackLinks: MissingBackLink[];
  counts: Record<LifecycleState, number>;
}

/** Resolves a link's note part from a source note to vault-relative paths. */
export type NoteResolver = (source: string, target: string) => string[];

function stemOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "").normalize("NFC");
}

/** Heading links in a note body, keeping the heading part `wikiTargets` drops. */
export function headingLinksIn(text: string): LinkRef[] {
  const visible = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  return parseLinks(visible).filter((link) => link.heading);
}

/**
 * Check every lifecycle link in the vault: targets exist, both sides agree,
 * no cycles, dates are dates, nothing expired is still presented as live, and
 * no Capsule points at a decision that is no longer true.
 */
export function analyzeLifecycle(
  contents: Map<string, string>,
  resolveNote: NoteResolver,
  capsulePaths: string[],
  on: string = today(),
): LifecycleAnalysis {
  const issues: LifecycleIssue[] = [];
  const missingBackLinks: MissingBackLink[] = [];
  const counts: Record<LifecycleState, number> = { live: 0, superseded: 0, expired: 0 };

  const sectionsOf = new Map<string, MemorySection[]>();
  for (const [path, text] of contents) sectionsOf.set(path, parseSections(path, text));

  const resolveLink = (source: string, link: LinkRef): MemorySection | string => {
    if (!link.heading) return `${link.raw} must point at a heading, e.g. [[Note#Heading]]`;
    let path = source;
    if (link.note) {
      const matches = resolveNote(source, link.note);
      if (matches.length === 0) return `${link.raw}: note not found`;
      if (matches.length > 1) return `${link.raw}: resolves to ${matches.join(", ")}`;
      path = matches[0];
    }
    const target = findSection(sectionsOf.get(path) ?? [], link.heading);
    return target ?? `${link.raw}: no heading "${link.heading}" in ${stemOf(path)}`;
  };

  const id = (section: MemorySection) => `${section.path}\u0000${headingKey(section.heading)}`;
  // Edges point from the replaced section to its replacement.
  const replacedBy = new Map<string, Set<string>>();
  const byId = new Map<string, MemorySection>();
  const addEdge = (from: MemorySection, to: MemorySection) => {
    byId.set(id(from), from);
    byId.set(id(to), to);
    const set = replacedBy.get(id(from)) ?? new Set<string>();
    set.add(id(to));
    replacedBy.set(id(from), set);
  };

  for (const [path, sections] of sectionsOf) {
    for (const section of sections) {
      const tracked =
        section.supersedes.length ||
        section.supersededBy.length ||
        section.validUntil ||
        section.supersededOn ||
        section.badDates.length;
      if (tracked) counts[sectionState(section, on)] += 1;

      for (const bad of section.badDates) {
        issues.push({
          level: "error",
          code: "LIFECYCLE",
          message: `"${section.heading}": ${bad} is not a YYYY-MM-DD date`,
          file: path,
        });
      }

      for (const link of section.supersedes) {
        const target = resolveLink(path, link);
        if (typeof target === "string") {
          issues.push({
            level: "error",
            code: "LIFECYCLE",
            message: `supersedes:: ${target}`,
            file: path,
          });
          continue;
        }
        addEdge(target, section);
        const agrees = target.supersededBy.some(
          (back) => resolveLink(target.path, back) === section,
        );
        if (!agrees) {
          issues.push({
            level: "warning",
            code: "LIFECYCLE",
            message: `"${section.heading}" supersedes "${target.heading}", but "${target.heading}" has no superseded-by:: back to it; run \`vulcanus doctor --repair\``,
            file: target.path,
          });
          missingBackLinks.push({
            path: target.path,
            heading: target.heading,
            fields: [
              `superseded-by:: ${headingLink(stemOf(path), section.heading)}`,
              ...(target.supersededOn ? [] : [`superseded-on:: ${on}`]),
            ],
          });
        }
      }

      for (const link of section.supersededBy) {
        const target = resolveLink(path, link);
        if (typeof target === "string") {
          issues.push({
            level: "error",
            code: "LIFECYCLE",
            message: `superseded-by:: ${target}`,
            file: path,
          });
          continue;
        }
        addEdge(section, target);
        const agrees = target.supersedes.some((back) => resolveLink(target.path, back) === section);
        if (!agrees) {
          issues.push({
            level: "warning",
            code: "LIFECYCLE",
            message: `"${section.heading}" is superseded by "${target.heading}", but "${target.heading}" has no supersedes:: back to it; run \`vulcanus doctor --repair\``,
            file: target.path,
          });
          missingBackLinks.push({
            path: target.path,
            heading: target.heading,
            fields: [`supersedes:: ${headingLink(stemOf(path), section.heading)}`],
          });
        }
      }

      if (sectionState(section, on) === "expired") {
        issues.push({
          level: "warning",
          code: "EXPIRED",
          message: `"${section.heading}" was valid until ${section.validUntil}; supersede it, extend valid-until::, or confirm it still holds`,
          file: path,
        });
      }
    }
  }

  // --- Cycles ---------------------------------------------------------------
  const visiting = new Set<string>();
  const done = new Set<string>();
  const reported = new Set<string>();
  const visit = (node: string, trail: string[]): void => {
    if (done.has(node)) return;
    if (visiting.has(node)) {
      const loop = trail.slice(trail.indexOf(node));
      const key = [...loop].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        const names = [...loop, node].map((entry) => `"${byId.get(entry)!.heading}"`);
        issues.push({
          level: "error",
          code: "LIFECYCLE",
          message: `supersession cycle: ${names.join(" → ")}`,
          file: byId.get(node)!.path,
        });
      }
      return;
    }
    visiting.add(node);
    for (const next of replacedBy.get(node) ?? []) visit(next, [...trail, node]);
    visiting.delete(node);
    done.add(node);
  };
  for (const node of [...replacedBy.keys()].sort()) visit(node, []);

  // --- Capsules pointing at dead memory ----------------------------------------
  for (const capsule of capsulePaths) {
    const text = contents.get(capsule);
    if (text === undefined) continue;
    for (const link of headingLinksIn(text)) {
      const target = resolveLink(capsule, link);
      if (typeof target === "string") continue; // a plain broken link is not this check's job
      const state = sectionState(target, on);
      if (state !== "live") {
        issues.push({
          level: "warning",
          code: "STALE-REF",
          message: `links ${link.raw}, which is ${state}; point the capsule at what replaced it`,
          file: capsule,
        });
      }
    }
  }

  // One back-reference per (note, heading), however many times it was found.
  const unique = new Map<string, MissingBackLink>();
  for (const entry of missingBackLinks) {
    const key = `${entry.path}\u0000${headingKey(entry.heading)}\u0000${entry.fields[0]}`;
    if (!unique.has(key)) unique.set(key, entry);
  }

  return { issues, missingBackLinks: [...unique.values()], counts };
}
