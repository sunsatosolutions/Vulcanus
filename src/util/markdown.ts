export interface Frontmatter {
  type: string;
  project: string;
  status: string;
  tags: string[];
  [key: string]: string | string[] | undefined;
}

const RESERVED_ORDER = ["type", "project", "status"];

export function renderFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = ["---"];
  for (const key of RESERVED_ORDER) {
    lines.push(`${key}: ${frontmatter[key] as string}`);
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (RESERVED_ORDER.includes(key) || key === "tags") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push("tags:");
  for (const tag of frontmatter.tags) lines.push(`  - ${tag}`);
  lines.push("---");
  return lines.join("\n");
}

export interface ParsedNote {
  /** Raw frontmatter lines between the delimiters, or null when absent. */
  frontmatterLines: string[] | null;
  /** Frontmatter keys in the order they appeared, including duplicates. */
  keys: string[];
  values: Record<string, string>;
  tags: string[];
  body: string;
  /** Structural problems found while parsing the frontmatter block. */
  issues: string[];
}

/**
 * Minimal YAML-ish frontmatter reader that accepts exactly the subset the
 * generated notes use: `key: value` lines plus a `tags:` list of `- item`.
 * Anything else is reported instead of silently accepted.
 */
export function parseNote(text: string): ParsedNote {
  const lines = text.split(/\r?\n/);
  const issues: string[] = [];

  if (lines[0]?.trim() !== "---") {
    return {
      frontmatterLines: null,
      keys: [],
      values: {},
      tags: [],
      body: text,
      issues: ["missing opening frontmatter delimiter"],
    };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {
      frontmatterLines: null,
      keys: [],
      values: {},
      tags: [],
      body: text,
      issues: ["missing closing frontmatter delimiter"],
    };
  }

  const block = lines.slice(1, closingIndex);
  const keys: string[] = [];
  const values: Record<string, string> = {};
  const tags: string[] = [];
  let activeList: string | null = null;

  for (const line of block) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const keyMatch = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = (keyMatch[2] ?? "").trim().replace(/^["']|["']$/g, "");
      keys.push(key);
      values[key] = value;
      activeList = value === "" ? key : null;
      continue;
    }

    const listMatch = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (listMatch && activeList === "tags") {
      tags.push(listMatch[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }

    if (!/^[ \t]/.test(line)) issues.push(`unsupported frontmatter line: ${line}`);
  }

  return {
    frontmatterLines: block,
    keys,
    values,
    tags,
    body: lines.slice(closingIndex + 1).join("\n"),
    issues,
  };
}

/** Strip fenced code, inline code, and HTML comments before scanning for links. */
export function visibleMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** Wikilink targets in a note, with aliases, headings, and blocks removed. */
export function wikiTargets(text: string): string[] {
  const visible = visibleMarkdown(text);
  const targets: string[] = [];
  const pattern = /!?\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible)) !== null) {
    const raw = match[1];
    const target = raw.split("|")[0].split("#")[0].split("^")[0].trim().normalize("NFC");
    if (target) targets.push(target);
  }
  return targets;
}

export function link(name: string): string {
  return `[[${name}]]`;
}
