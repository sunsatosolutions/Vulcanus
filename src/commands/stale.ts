import { noVaultProblem, reportProblem } from "../errors.js";
import { buildPlan, type ProjectPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { DEFAULT_STALE_DAYS, findStale, type StaleReport } from "../memory/staleness.js";
import * as p from "../ui.js";
import { findProject } from "./project.js";

export interface StaleOptions {
  cwd?: string;
  json?: boolean;
  /** Age, in days, beyond which a section counts as stale. */
  days?: number | string;
}

/** The threshold as a positive whole number of days, or null when it is not one. */
export function parseDays(value: number | string | undefined): number | null {
  if (value === undefined) return DEFAULT_STALE_DAYS;
  const days = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(days) && days > 0 ? days : null;
}

export function badDaysProblem(value: unknown) {
  return {
    what: `--days needs a positive whole number, got "${String(value)}".`,
    why: "The threshold is the number of days a decision or rule may sit unchanged while its project moves on.",
    fix: `vulcanus stale --days ${DEFAULT_STALE_DAYS}`,
  };
}

/** Projects named by the query, or all of them; null when the query matches none. */
export function selectProjects(
  manifest: Awaited<ReturnType<typeof readManifest>>,
  query: string | undefined,
): ProjectPlan[] | null {
  const plans = buildPlan(manifest).allProjects;
  if (!query) return plans;
  const found = findProject(manifest, query);
  return found ? plans.filter((plan) => plan.project.id === found.id) : null;
}

export function unknownProjectProblem(
  manifest: Awaited<ReturnType<typeof readManifest>>,
  query: string,
) {
  return {
    what: `No project named "${query}" in ${manifest.vault.name}.`,
    why: `Known projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none yet"}.`,
    fix: "Use the name or id exactly as `vulcanus status` lists it.",
  };
}

export function staleCount(report: StaleReport): number {
  return report.projects.reduce((sum, entry) => sum + entry.stale.length, 0);
}

export async function staleCommand(
  projectQuery: string | undefined,
  options: StaleOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus stale"));

  const days = parseDays(options.days);
  if (days === null) return reportProblem(badDaysProblem(options.days));

  const manifest = await readManifest(vaultRoot);
  const targets = selectProjects(manifest, projectQuery);
  if (!targets) return reportProblem(unknownProjectProblem(manifest, projectQuery!));

  const report = await findStale(vaultRoot, targets, days);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  p.intro(`stale — ${manifest.vault.name}`);
  for (const entry of report.projects) {
    if (entry.checked === 0) continue;
    const lines = [
      ...entry.stale.map(
        (item) =>
          `▲ ${item.note}:${item.line}  "${item.heading}" — last changed ${item.lastChanged}, ${item.ageDays} days before the project's last movement`,
      ),
      ...entry.unknown.map(
        (item) => `? ${item.note}:${item.line}  "${item.heading}" — age unknown (no git history)`,
      ),
    ];
    const moved = entry.reference
      ? `last movement ${entry.reference.date} (${entry.reference.from})`
      : "last movement unknown";
    if (lines.length === 0) {
      p.log.success(
        `${entry.project}: ${entry.checked} sections, none older than ${days} days — ${moved}`,
      );
    } else {
      p.log.message(`${entry.project}  (${moved})\n${lines.join("\n")}`);
    }
  }
  const total = staleCount(report);
  p.outro(
    total
      ? `${total} stale section${total === 1 ? "" : "s"} (older than ${days} days). Nothing was written; \`vulcanus review\` decides each.`
      : `Nothing older than ${days} days.`,
  );
  return 0;
}
