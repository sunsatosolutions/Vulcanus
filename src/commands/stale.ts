import * as p from "../ui.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { EXIT, noVaultProblem, reportProblem, type ExitCode } from "../errors.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { parseSections } from "../memory/lifecycle.js";
import {
  buildReport,
  DEFAULT_STALE_DAYS,
  isoDate,
  isTrackable,
  latestChange,
  parseBlame,
  type BlameLine,
  type StaleEntry,
  type StaleKind,
  type StaleReport,
} from "../memory/staleness.js";
import { gitCommitTime } from "./status.js";

const run = promisify(execFile);

export interface StaleOptions {
  cwd?: string;
  json?: boolean;
  /** Threshold override; the manifest's `staleDays`, then 90, otherwise. */
  days?: string | number;
  /** The clock; tests pin it. */
  now?: Date;
}

/** Line-by-line commit times for a note; null when git has no history for it. */
async function blameOf(vaultRoot: string, path: string): Promise<BlameLine[] | null> {
  try {
    const { stdout } = await run("git", ["blame", "--line-porcelain", "--", path], {
      cwd: vaultRoot,
      maxBuffer: 256 * 1024 * 1024,
    });
    return parseBlame(stdout);
  } catch {
    return null;
  }
}

/** Parse `--days`: a whole number of days, 0 or more. */
export function parseDays(value: string | number): number | null {
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

export async function collectStale(
  vaultRoot: string,
  days: number,
  now: Date = new Date(),
): Promise<StaleReport> {
  const manifest = await readManifest(vaultRoot);
  const plan = buildPlan(manifest);
  const useGit = existsSync(resolve(vaultRoot, ".git"));
  const records: Parameters<typeof buildReport>[0] = [];

  for (const project of plan.allProjects) {
    const activity = useGit ? await gitCommitTime(vaultRoot, project.dir) : null;
    const base = {
      project: project.project.name,
      projectLastActivity: isoDate(activity === null ? null : Math.floor(activity / 1000)),
    };

    const notes: Array<{ kind: StaleKind; path: string }> = [
      { kind: "decision", path: project.decisions.path },
      { kind: "rule", path: project.rules.path },
      { kind: "capsule", path: project.capsule.path },
    ];
    for (const { kind, path } of notes) {
      const absolute = resolve(vaultRoot, path);
      if (!existsSync(absolute)) continue;
      const blame = useGit ? await blameOf(vaultRoot, path) : null;

      if (kind === "capsule") {
        const changed = blame ? latestChange(blame, 1, blame.length) : null;
        records.push({ ...base, kind, note: path, heading: null, changedAt: changed });
        continue;
      }
      const sections = parseSections(path, await readFile(absolute, "utf8"));
      for (const section of sections) {
        if (!isTrackable(section)) continue;
        records.push({
          ...base,
          kind,
          note: path,
          heading: section.heading,
          changedAt: blame ? latestChange(blame, section.line, section.endLine) : null,
        });
      }
    }
  }

  return buildReport(records, days, now);
}

function describe(entry: StaleEntry): string {
  const what = entry.heading ? `${entry.note} → ${entry.heading}` : entry.note;
  const age =
    entry.ageDays === null ? "age unknown" : `${entry.ageDays} days (${entry.lastChanged})`;
  return `${what}\n    ${entry.project} · ${age} · project last active ${entry.projectLastActivity ?? "unknown"}`;
}

export async function staleCommand(options: StaleOptions = {}): Promise<ExitCode> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus stale"));

  let days: number;
  if (options.days !== undefined) {
    const parsed = parseDays(options.days);
    if (parsed === null) {
      return reportProblem({
        what: `--days does not accept "${String(options.days)}".`,
        why: "It takes a whole number of days, 0 or more.",
        fix: "vulcanus stale --days 90",
      });
    }
    days = parsed;
  } else {
    days = (await readManifest(vaultRoot)).staleDays ?? DEFAULT_STALE_DAYS;
  }

  const report = await collectStale(vaultRoot, days, options.now);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT.ok;
  }

  p.intro(`stale — older than ${days} days`);
  if (report.stale.length) {
    p.note(report.stale.map(describe).join("\n"), `Stale (${report.stale.length}), oldest first`);
  } else {
    p.log.success(`Nothing older than ${days} days.`);
  }
  if (report.unknown.length) {
    p.note(
      report.unknown.map(describe).join("\n"),
      `Unknown (${report.unknown.length}) — git has no date for these`,
    );
  }
  p.outro(
    report.stale.length
      ? "Confirm each still holds, supersede it, or mark it `evergreen:: true`."
      : "Done.",
  );
  return EXIT.ok;
}
