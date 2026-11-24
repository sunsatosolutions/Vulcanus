/**
 * Staleness: which live decisions, rules, and capsules nobody has touched in a
 * long time.
 *
 * A decision that was true a year ago may still be true, but nothing in the
 * vault says anyone checked. The date a section last changed comes from git
 * history only. File mtime is not a fallback: a fresh clone stamps every file
 * with the clone time, which would make the whole vault look new. No history
 * means the date is unknown, and unknown is reported as unknown.
 *
 * Pure functions: parsing, dating, and filtering. Running git is the
 * command's job.
 */

import { sectionState, type MemorySection } from "./lifecycle.js";

export const DEFAULT_STALE_DAYS = 90;

const DAY_MS = 86_400_000;

export type StaleKind = "decision" | "rule" | "capsule";

/** One line of a note as git blame sees it. */
export interface BlameLine {
  /** Epoch seconds of the commit that last touched the line; null if uncommitted. */
  time: number | null;
  blank: boolean;
}

export interface StaleEntry {
  project: string;
  kind: StaleKind;
  /** Vault-relative path of the note. */
  note: string;
  /** The `## ` heading; null for a capsule, which is dated as a whole. */
  heading: string | null;
  /** ISO date (UTC) of the last change; null when git cannot say. */
  lastChanged: string | null;
  /** Whole days between the last change and now; null when unknown. */
  ageDays: number | null;
  /** ISO date (UTC) of the last commit anywhere in the project's folder. */
  projectLastActivity: string | null;
}

export interface StaleReport {
  days: number;
  /** Older than `days`, oldest first. */
  stale: StaleEntry[];
  /** Records git cannot date. */
  unknown: StaleEntry[];
}

/**
 * Read `git blame --line-porcelain` output: one header block per line, ending
 * with the line's own text behind a tab. An all-zero hash means the line is
 * not committed yet.
 */
export function parseBlame(porcelain: string): BlameLine[] {
  const lines: BlameLine[] = [];
  let uncommitted = false;
  let time: number | null = null;
  for (const row of porcelain.split("\n")) {
    if (row.startsWith("\t")) {
      lines.push({ time: uncommitted ? null : time, blank: row.trim() === "" });
      uncommitted = false;
      time = null;
      continue;
    }
    const header = /^([0-9a-f]{40}) \d+ \d+/.exec(row);
    if (header) {
      uncommitted = /^0{40}$/.test(header[1]);
      continue;
    }
    const committer = /^committer-time (\d+)$/.exec(row);
    if (committer) time = Number(committer[1]);
  }
  return lines;
}

/**
 * Newest commit time (epoch seconds) among a range of 1-indexed lines. Null
 * when any non-blank line is uncommitted or missing from the blame: the text
 * was edited after the last commit, so the history would only show an older,
 * misleading date.
 */
export function latestChange(blame: BlameLine[], from: number, to: number): number | null {
  let latest: number | null = null;
  for (let line = from; line <= to; line += 1) {
    const entry = blame[line - 1];
    if (!entry) {
      // Past the end of the file: the empty tail of a trailing newline.
      continue;
    }
    if (entry.time === null) {
      if (entry.blank) continue;
      return null;
    }
    if (latest === null || entry.time > latest) latest = entry.time;
  }
  return latest;
}

/** One `git diff HEAD -U0` hunk: 1-indexed starts; a count of 0 means a pure insertion or deletion. */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const row of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (!m) continue;
    hunks.push({
      oldStart: Number(m[1]),
      oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newCount: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks;
}

/**
 * True when uncommitted work removed lines inside the working-tree range
 * `from..to`. Blame has no row for a deleted line, so it cannot see this. A
 * zero-count hunk at `newStart` sits just after that line.
 */
export function hasUncommittedDeletion(hunks: DiffHunk[], from: number, to: number): boolean {
  return hunks.some((h) => h.oldCount > 0 && h.newStart >= from && h.newStart <= to);
}

/** Map a working-tree line number back to the HEAD file the history is read from. */
export function headLine(hunks: DiffHunk[], line: number): number {
  let shift = 0;
  for (const h of hunks) {
    const end = h.newCount === 0 ? h.newStart : h.newStart + h.newCount - 1;
    if (end < line) shift += h.newCount - h.oldCount;
  }
  return line - shift;
}

/** A section git may date: live, and not marked `evergreen:: true`. */
export function isTrackable(section: MemorySection, on?: string): boolean {
  return sectionState(section, on) === "live" && !section.evergreen;
}

export function isoDate(epochSeconds: number | null): string | null {
  return epochSeconds === null ? null : new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function ageInDays(epochSeconds: number, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - epochSeconds * 1000) / DAY_MS));
}

/** Split dated records into stale (older than `days`, oldest first) and unknown. */
export function buildReport(
  records: Array<Omit<StaleEntry, "lastChanged" | "ageDays"> & { changedAt: number | null }>,
  days: number,
  now: Date,
): StaleReport {
  const stale: StaleEntry[] = [];
  const unknown: StaleEntry[] = [];
  for (const record of records) {
    const { changedAt } = record;
    const entry = (lastChanged: string | null, ageDays: number | null): StaleEntry => ({
      project: record.project,
      kind: record.kind,
      note: record.note,
      heading: record.heading,
      lastChanged,
      ageDays,
      projectLastActivity: record.projectLastActivity,
    });
    if (changedAt === null) {
      unknown.push(entry(null, null));
      continue;
    }
    const ageDays = ageInDays(changedAt, now);
    if (ageDays > days) stale.push(entry(isoDate(changedAt), ageDays));
  }
  stale.sort((a, b) => b.ageDays! - a.ageDays! || a.note.localeCompare(b.note));
  unknown.sort(
    (a, b) => a.note.localeCompare(b.note) || (a.heading ?? "").localeCompare(b.heading ?? ""),
  );
  return { days, stale, unknown };
}
