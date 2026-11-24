import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ProjectPlan } from "../manifest/derive.js";
import { expandHome } from "../util/paths.js";
import { parseSections, sectionState, today, type MemorySection } from "./lifecycle.js";

/**
 * Staleness: decisions and rules nobody has touched while the project moved on.
 *
 * A section's age comes only from the commits that last changed its own lines
 * (`git blame`), never from the file's last commit: deleting or moving a
 * neighbouring section must not make an unchanged one look fresh. Where git
 * cannot say, the age is unknown, and unknown is reported as unknown.
 */

const run = promisify(execFile);
const DAY = 86_400;

export const DEFAULT_STALE_DAYS = 90;

export interface StaleSection {
  project: string;
  /** Vault-relative path of the note. */
  note: string;
  heading: string;
  line: number;
  /** ISO date of the commit that last changed the section's own lines. */
  lastChanged: string;
  /** Whole days between `lastChanged` and the project's last movement. */
  ageDays: number;
}

export interface UnknownSection {
  project: string;
  note: string;
  heading: string;
  line: number;
}

export interface ProjectStaleness {
  project: string;
  /** The project's last movement the ages are measured against; null when unknown. */
  reference: { date: string; from: "source" | "notes" } | null;
  checked: number;
  stale: StaleSection[];
  /** Sections git has no history for; never guessed. */
  unknown: UnknownSection[];
}

export interface StaleReport {
  days: number;
  projects: ProjectStaleness[];
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch {
    return null;
  }
}

/** Epoch seconds of the newest commit touching `paths` (or anything, when none are given). */
async function lastCommit(cwd: string, paths: string[] = []): Promise<number | null> {
  const out = await git(cwd, [
    "log",
    "-1",
    "--format=%ct",
    ...(paths.length ? ["--", ...paths] : []),
  ]);
  const epoch = Number(out?.trim());
  return out?.trim() && Number.isFinite(epoch) ? epoch : null;
}

/**
 * Commit time, in epoch seconds, of the commit behind each line of a note;
 * null for a blank line (reflowing whitespace is not a change of substance).
 * The whole array is null when git has no history for the file.
 */
export async function lineTimes(
  vaultRoot: string,
  path: string,
): Promise<Array<number | null> | null> {
  const out = await git(vaultRoot, ["blame", "--porcelain", "--", path]);
  if (out === null) return null;

  const committed = new Map<string, number>();
  const times: Array<number | null> = [];
  let sha = "";
  let line = 0;
  for (const row of out.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
    if (header) {
      sha = header[1];
      line = Number(header[2]);
    } else if (row.startsWith("committer-time ")) {
      committed.set(sha, Number(row.slice(15)));
    } else if (row.startsWith("\t")) {
      times[line - 1] = row.trim() === "" ? null : (committed.get(sha) ?? null);
    }
  }
  return times;
}

/** When a section's own lines last changed, in epoch seconds; null when unknown. */
export function sectionTime(
  times: Array<number | null> | null,
  section: MemorySection,
): number | null {
  if (!times) return null;
  let newest: number | null = null;
  for (let line = section.line; line <= section.endLine; line += 1) {
    const time = times[line - 1];
    if (time != null && (newest === null || time > newest)) newest = time;
  }
  return newest;
}

const isoDate = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10);

/** The project's last movement: its source folder's newest commit, else its notes'. */
async function projectMovement(
  vaultRoot: string,
  project: ProjectPlan,
): Promise<{ epoch: number; from: "source" | "notes" } | null> {
  const declared = project.project.root;
  const source =
    typeof declared === "string" ? resolve(vaultRoot, expandHome(declared)) : undefined;
  const fromSource = source && existsSync(source) ? await lastCommit(source) : null;
  const notes = project.notes
    .map((note) => note.path)
    .filter((path) => existsSync(resolve(vaultRoot, path)));
  const fromNotes = notes.length ? await lastCommit(vaultRoot, notes) : null;

  if (fromSource !== null && (fromNotes === null || fromSource >= fromNotes)) {
    return { epoch: fromSource, from: "source" };
  }
  return fromNotes === null ? null : { epoch: fromNotes, from: "notes" };
}

/** Live, non-evergreen sections of a project's Decisions and Rules notes. */
export async function stalenessOf(
  vaultRoot: string,
  project: ProjectPlan,
  days: number = DEFAULT_STALE_DAYS,
  on: string = today(),
): Promise<ProjectStaleness> {
  const result: ProjectStaleness = {
    project: project.project.name,
    reference: null,
    checked: 0,
    stale: [],
    unknown: [],
  };
  const movement = await projectMovement(vaultRoot, project);
  if (movement) result.reference = { date: isoDate(movement.epoch), from: movement.from };

  for (const note of [project.decisions, project.rules]) {
    const file = resolve(vaultRoot, note.path);
    if (!existsSync(file)) continue;
    const sections = parseSections(note.path, await readFile(file, "utf8")).filter(
      (section) => sectionState(section, on) === "live" && !section.evergreen,
    );
    if (sections.length === 0) continue;
    const times = await lineTimes(vaultRoot, note.path);

    for (const section of sections) {
      result.checked += 1;
      const changed = sectionTime(times, section);
      if (changed === null || movement === null) {
        result.unknown.push({
          project: result.project,
          note: note.path,
          heading: section.heading,
          line: section.line,
        });
        continue;
      }
      const ageDays = Math.floor((movement.epoch - changed) / DAY);
      if (ageDays > days) {
        result.stale.push({
          project: result.project,
          note: note.path,
          heading: section.heading,
          line: section.line,
          lastChanged: isoDate(changed),
          ageDays,
        });
      }
    }
  }
  return result;
}

export async function findStale(
  vaultRoot: string,
  projects: ProjectPlan[],
  days: number = DEFAULT_STALE_DAYS,
): Promise<StaleReport> {
  const out: ProjectStaleness[] = [];
  for (const project of projects) out.push(await stalenessOf(vaultRoot, project, days));
  return { days, projects: out };
}
