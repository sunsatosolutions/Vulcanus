import { extractClaims } from "./drift.js";
import { isIsoDate, parseSections } from "./lifecycle.js";
import { parseNote } from "../util/markdown.js";

/**
 * Note freshness: how long ago a person last looked at a note, and whether the
 * files it names still exist. Pure: the clock and the file system come in as
 * arguments, so every state is testable without touching a disk.
 *
 * A note says when it was last checked (`reviewed:`) and, optionally, how long
 * that stays good (`stale_after:`, in days). The manifest supplies a default
 * per note type. Nothing here is ever a verdict on whether the prose is true.
 */

export type FreshnessState = "fresh" | "stale" | "dead-ref" | "unknown";

export interface NoteFreshness {
  path: string;
  state: FreshnessState;
  /** The `reviewed:` date, when it is a valid one. */
  reviewed?: string;
  /** Days the review stays good: the note's own `stale_after:`, else the manifest default. */
  staleAfter?: number;
  /** Days since `reviewed:`. */
  ageDays?: number;
  /** Relative paths the note names in code that do not exist. */
  deadRefs: string[];
  /** Fields that could not be read, one sentence each. */
  problems: string[];
}

export interface FreshnessContext {
  /** ISO date treated as today. */
  today: string;
  /** Manifest defaults: frontmatter `type` to days. */
  staleAfterDays: Record<string, number>;
  /** Whether a relative path (as the note wrote it) exists; the caller decides where to look. */
  exists: (path: string) => boolean;
  /** False for notes whose paths are examples, not claims: no dead-ref is looked for. */
  checkRefs: boolean;
}

const DAY_MS = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function wholeDays(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

/** Relative file and folder paths a note writes as code, without duplicates. */
export function pathRefs(path: string, text: string, on: string): string[] {
  const claims = extractClaims(text, parseSections(path, text), on);
  return [
    ...new Set(
      claims
        .filter((claim) => claim.kind === "path")
        .map((claim) => claim.target.replace(/^\.\//, "")),
    ),
  ];
}

export function assessNote(path: string, text: string, context: FreshnessContext): NoteFreshness {
  const parsed = parseNote(text);
  const problems: string[] = [];
  const result: NoteFreshness = { path, state: "unknown", deadRefs: [], problems };

  const type = (parsed.values.type ?? "").toLowerCase();
  const own = parsed.values.stale_after;
  let staleAfter: number | undefined;
  if (own !== undefined && own !== "") {
    const days = wholeDays(own);
    if (days === null) problems.push(`stale_after "${own}" is not a whole number of days above 0`);
    else staleAfter = days;
  }
  staleAfter ??= Object.entries(context.staleAfterDays).find(
    ([key]) => key.toLowerCase() === type,
  )?.[1];
  if (staleAfter !== undefined) result.staleAfter = staleAfter;

  const reviewed = parsed.values.reviewed;
  if (reviewed !== undefined && reviewed !== "") {
    if (!isIsoDate(reviewed)) {
      problems.push(`reviewed "${reviewed}" is not a YYYY-MM-DD date`);
    } else if (reviewed > context.today) {
      problems.push(`reviewed ${reviewed} is in the future`);
    } else {
      result.reviewed = reviewed;
      result.ageDays = daysBetween(reviewed, context.today);
    }
  }

  if (context.checkRefs) {
    result.deadRefs = pathRefs(path, text, context.today).filter((ref) => !context.exists(ref));
  }

  if (result.ageDays !== undefined && staleAfter !== undefined) {
    if (result.ageDays > staleAfter) result.state = "stale";
    else if (result.deadRefs.length === 0) result.state = "fresh";
  }
  if (result.state === "unknown" && result.deadRefs.length > 0) result.state = "dead-ref";
  return result;
}

/** Stale notes, longest unreviewed first. */
export function oldestFirst(notes: NoteFreshness[]): NoteFreshness[] {
  return notes
    .filter((note) => note.state === "stale")
    .sort(
      (a, b) =>
        (b.ageDays ?? 0) - (a.ageDays ?? 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
}

/**
 * The note with `reviewed:` set to `on`, and every other byte as it was: the
 * line is replaced where it stands, or added just before the closing `---`.
 * Null when the note has no frontmatter to put it in.
 */
export function stampReviewed(text: string, on: string): string | null {
  const parts = text.split(/(\r?\n)/); // even indexes are lines, odd are their line breaks
  if (parts[0].trim() !== "---") return null;
  let close = -1;
  for (let index = 2; index < parts.length; index += 2) {
    if (parts[index].trim() === "---") {
      close = index;
      break;
    }
  }
  if (close === -1) return null;

  let replaced = false;
  for (let index = 2; index < close; index += 2) {
    if (/^reviewed:/.test(parts[index])) {
      parts[index] = `reviewed: ${on}`;
      replaced = true;
    }
  }
  if (!replaced) parts.splice(close, 0, `reviewed: ${on}`, parts[close - 1]);
  return parts.join("");
}
