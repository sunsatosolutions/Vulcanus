import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sectionAt, sectionState, stripComments, today, type MemorySection } from "./lifecycle.js";

/**
 * Drift: claims a note makes about the code that the code no longer backs.
 *
 * Deliberately a heuristic. It reads only what is hard to misread — a relative
 * path or an `npm` script written as code — and checks it against the project
 * folder. It never judges prose, and it never writes anything.
 */

export type ClaimKind = "path" | "script";

export interface Claim {
  /** 1-indexed line in the note. */
  line: number;
  /** The claim as written: the path, or the `npm …` command. */
  text: string;
  kind: ClaimKind;
  /** What is looked up: the path, or the script name. */
  target: string;
}

export interface Drift extends Claim {
  reason: string;
}

/** Extensions that make a bare word (no slash) a file name instead of prose. */
const FILE_EXTENSIONS = new Set(
  "ts tsx js jsx mjs cjs json md mdx yml yaml toml py go rs sh css scss html sql lock txt cfg ini".split(
    " ",
  ),
);

const COMMAND = /\bnpm\s+(?:run(?:-script)?\s+([A-Za-z0-9_][\w:.-]*)|(test|start)\b)/g;
const PATH_SHAPE = /^(?:\.\/)?[\p{L}\p{N}_.-]+(?:\/[\p{L}\p{N}_.-]+)*\/?$/u;

function extensionOf(segment: string): string | null {
  const dot = segment.lastIndexOf(".");
  return dot > 0 ? segment.slice(dot + 1).toLowerCase() : null;
}

/** The relative file or folder a token claims, or null when it is not one. */
function pathClaim(token: string): string | null {
  const value = token.replace(/:\d+(?::\d+)?$/, "");
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // URLs, drive letters
  if (/^[/\\~@#$<-]/.test(value) || /[*?[\]{}<>$|&;"'=\\\s]/.test(value)) return null;
  if (!PATH_SHAPE.test(value)) return null;

  const segments = value.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  if (segments.includes("..") || segments.includes(".")) return null;

  const last = segments[segments.length - 1];
  const ext = extensionOf(last);
  if (segments.length === 1 && !value.endsWith("/")) {
    return ext && FILE_EXTENSIONS.has(ext) ? value : null;
  }
  // `and/or` and `client/server` are prose; a path says so with an extension,
  // a trailing slash, a leading `./`, or enough depth.
  const looksLikePath =
    value.endsWith("/") ||
    value.startsWith("./") ||
    segments.length >= 3 ||
    (ext !== null && /^[a-z][a-z0-9]{0,4}$/.test(ext));
  if (!looksLikePath) return null;

  // `example.com/a/b` is an address, not a folder.
  const head = segments[0];
  const headExt = extensionOf(head);
  if (headExt && !FILE_EXTENSIONS.has(headExt) && segments.length > 1) return null;
  return value;
}

function commandClaims(text: string, line: number): Claim[] {
  const claims: Claim[] = [];
  for (const match of text.matchAll(COMMAND)) {
    const target = match[1] ?? match[2];
    claims.push({ line, text: match[0].replace(/\s+/g, " "), kind: "script", target });
  }
  return claims;
}

/** Strip trailing punctuation a sentence or a shell line puts after a path. */
function cleanToken(token: string): string {
  return token.replace(/^[("'`]+|[)"'`,;.]+$/g, "");
}

/**
 * Claims in one note: inline code spans and fenced blocks only. Frontmatter and
 * Comments are stripped first (`stripComments`), and so is any section lifecycle has retired — a
 * superseded decision is history, and history is allowed to be wrong now.
 */
export function extractClaims(
  text: string,
  sections: MemorySection[] = [],
  on: string = today(),
): Claim[] {
  const lines = stripComments(text).split("\n");
  const claims: Claim[] = [];
  let fence: string | null = null;
  let start = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end !== -1) start = end + 1;
  }

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const number = index + 1;

    const trimmed = line.trim();

    const fenceMatch = /^(```|~~~)/.exec(trimmed);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
      continue;
    }

    const section = sectionAt(sections, number);
    if (section && sectionState(section, on) !== "live") continue;

    if (fence !== null) {
      claims.push(...commandClaims(line, number));
      for (const token of line.split(/\s+/)) {
        const target = pathClaim(cleanToken(token));
        if (target) claims.push({ line: number, text: target, kind: "path", target });
      }
      continue;
    }

    for (const span of line.matchAll(/(`+)([^`\n]+?)\1/g)) {
      const code = span[2].trim();
      claims.push(...commandClaims(code, number));
      const target = /\s/.test(code) ? null : pathClaim(code);
      if (target) claims.push({ line: number, text: target, kind: "path", target });
    }
  }

  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.line}\0${claim.kind}\0${claim.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The root's `package.json` scripts, or why they cannot be read. */
export function readScripts(
  root: string,
): { scripts: Record<string, unknown> } | { error: string } {
  const file = resolve(root, "package.json");
  if (!existsSync(file)) return { error: "the project root has no package.json" };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { scripts?: unknown };
    const scripts = parsed.scripts;
    return {
      scripts:
        scripts && typeof scripts === "object" && !Array.isArray(scripts)
          ? (scripts as Record<string, unknown>)
          : {},
    };
  } catch {
    return { error: "package.json at the project root is not valid JSON" };
  }
}

/** Claims the project folder does not back. Read-only. */
export function findDrift(claims: Claim[], root: string): Drift[] {
  const read = claims.some((claim) => claim.kind === "script") ? readScripts(root) : null;
  const drift: Drift[] = [];

  for (const claim of claims) {
    if (claim.kind === "path") {
      if (!existsSync(resolve(root, claim.target))) {
        drift.push({ ...claim, reason: "path not found under the project root" });
      }
    } else if (read && "error" in read) {
      drift.push({ ...claim, reason: read.error });
    } else if (
      read &&
      !Object.hasOwn(read.scripts, claim.target) &&
      // `npm start` falls back to `node server.js` when no script says otherwise.
      !(claim.target === "start" && existsSync(resolve(root, "server.js")))
    ) {
      drift.push({ ...claim, reason: `package.json has no "${claim.target}" script` });
    }
  }
  return drift;
}
