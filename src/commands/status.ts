import * as p from "@clack/prompts";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { runDoctor } from "../doctor/index.js";
import { buildPlan, type VaultPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { compareVersions } from "../util/semver.js";
import { CLI_VERSION } from "../version.js";

const run = promisify(execFile);

export interface StatusOptions {
  cwd?: string;
  json?: boolean;
}

export interface GitStatus {
  branch: string;
  /** ISO date of the last commit touching the vault. */
  lastCommit: string | null;
  /** Files changed but not yet committed. */
  dirty: number;
}

export interface StaleCapsule {
  project: string;
  capsule: string;
  /** Source notes changed more recently than the capsule. */
  changedSince: string[];
}

export interface StatusSummary {
  vault: string;
  root: string;
  cliVersion: string;
  generatedBy: string;
  /** The CLI is newer than the vault: `vulcanus update` would refresh it. */
  updateAvailable: boolean;
  profile: string;
  language: string;
  projects: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
    names: string[];
  };
  groups: number;
  plannedNotes: number;
  notesOnDisk: number;
  linksChecked: number;
  doctor: { ok: boolean; errors: number; warnings: number };
  imports: number;
  git: GitStatus | null;
  /** Capsules older than the Decisions/Rules/Context they summarize. */
  staleCapsules: StaleCapsule[];
}

async function gitStatus(vaultRoot: string): Promise<GitStatus | null> {
  if (!existsSync(resolve(vaultRoot, ".git"))) return null;
  try {
    const [branch, lastCommit, porcelain] = await Promise.all([
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: vaultRoot }),
      run("git", ["log", "-1", "--format=%cI"], { cwd: vaultRoot }).catch(() => ({ stdout: "" })),
      run("git", ["status", "--porcelain"], { cwd: vaultRoot }),
    ]);
    return {
      branch: branch.stdout.trim(),
      lastCommit: lastCommit.stdout.trim() || null,
      dirty: porcelain.stdout.split("\n").filter((line) => line.trim()).length,
    };
  } catch {
    return null;
  }
}

/**
 * When a note last changed: the last git commit touching it, or the file
 * mtime in a vault that is not a repository. Null when unknowable.
 */
async function lastChanged(
  vaultRoot: string,
  path: string,
  useGit: boolean,
): Promise<number | null> {
  const absolute = resolve(vaultRoot, path);
  if (!existsSync(absolute)) return null;
  if (useGit) {
    try {
      const { stdout } = await run("git", ["log", "-1", "--format=%ct", "--", path], {
        cwd: vaultRoot,
      });
      const epoch = Number(stdout.trim());
      // An uncommitted note has no history yet; fall through to its mtime.
      if (Number.isFinite(epoch) && stdout.trim()) return epoch * 1000;
    } catch {
      // git missing or not a repo after all — mtime still answers the question.
    }
  }
  try {
    return (await stat(absolute)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * A capsule is the compressed summary agents read first, so it must never lag
 * the notes it summarizes. Compare each capsule against its cluster's
 * Decisions, Rules, and Context.
 */
export async function findStaleCapsules(
  vaultRoot: string,
  plan: VaultPlan,
): Promise<StaleCapsule[]> {
  const useGit = existsSync(resolve(vaultRoot, ".git"));
  const stale: StaleCapsule[] = [];

  for (const project of plan.allProjects) {
    const capsuleTime = await lastChanged(vaultRoot, project.capsule.path, useGit);
    if (capsuleTime === null) continue;

    const changedSince: string[] = [];
    for (const note of [project.decisions, project.rules, project.context]) {
      const noteTime = await lastChanged(vaultRoot, note.path, useGit);
      // A one-second grace keeps freshly generated clusters, written in one
      // pass, from reading as stale.
      if (noteTime !== null && noteTime > capsuleTime + 1000) changedSince.push(note.name);
    }
    if (changedSince.length) {
      stale.push({
        project: project.project.name,
        capsule: project.capsule.name,
        changedSince,
      });
    }
  }

  return stale;
}

export async function collectStatus(vaultRoot: string): Promise<StatusSummary> {
  const manifest = await readManifest(vaultRoot);
  const plan = buildPlan(manifest);
  const report = await runDoctor(vaultRoot, manifest);

  const byStatus: Record<string, number> = {};
  for (const project of manifest.projects) {
    byStatus[project.status] = (byStatus[project.status] ?? 0) + 1;
  }

  return {
    vault: manifest.vault.name,
    root: vaultRoot,
    cliVersion: CLI_VERSION,
    generatedBy: manifest.generator.version,
    updateAvailable: compareVersions(manifest.generator.version, CLI_VERSION) < 0,
    profile: manifest.vault.profile,
    language: manifest.vault.language,
    projects: {
      total: manifest.projects.length,
      active: byStatus.active ?? 0,
      byStatus,
      names: manifest.projects.map((project) => project.name),
    },
    groups: manifest.groups.length,
    plannedNotes: plan.allNotes.length,
    notesOnDisk: report.filesChecked,
    linksChecked: report.linksChecked,
    doctor: {
      ok: report.ok,
      errors: report.counts.error,
      warnings: report.counts.warning,
    },
    imports: manifest.imports.length,
    git: await gitStatus(vaultRoot),
    staleCapsules: await findStaleCapsules(vaultRoot, plan),
  };
}

export async function statusCommand(options: StatusOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) {
    process.stderr.write(
      `No vulcanus.json found in ${start} or any parent directory.\nRun \`vulcanus init\` to create a vault.\n`,
    );
    return 2;
  }

  const summary = await collectStatus(vaultRoot);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary.doctor.ok ? 0 : 1;
  }

  p.intro(`status — ${summary.vault}`);

  const statusLine = Object.entries(summary.projects.byStatus)
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  const lines = [
    `vault      ${summary.vault} (${summary.profile}, ${summary.language})`,
    `root       ${summary.root}`,
    `projects   ${summary.projects.total}${statusLine ? ` (${statusLine})` : ""}`,
    `groups     ${summary.groups}`,
    `notes      ${summary.notesOnDisk} on disk / ${summary.plannedNotes} planned`,
    `links      ${summary.linksChecked} checked`,
    `doctor     ${summary.doctor.ok ? "PASS" : "FAIL"} — ${summary.doctor.errors} errors, ${summary.doctor.warnings} warnings`,
    `generator  Vulcanus ${summary.generatedBy}${summary.updateAvailable ? ` (you run ${summary.cliVersion} — \`vulcanus update\`)` : ""}`,
  ];
  if (summary.git) {
    const commit = summary.git.lastCommit ? summary.git.lastCommit.slice(0, 10) : "no commits";
    lines.push(
      `git        ${summary.git.branch} — last commit ${commit}, ${summary.git.dirty} uncommitted change(s)`,
    );
  }
  p.note(lines.join("\n"), "Vault health");

  if (summary.staleCapsules.length) {
    p.log.warn(
      [
        "Stale capsules — the summary an agent reads first lags the notes beneath it:",
        ...summary.staleCapsules.map(
          (entry) => `  ${entry.capsule} — ${entry.changedSince.join(", ")} changed since`,
        ),
        "Refresh them (or have your agent do it) so recall stays truthful.",
      ].join("\n"),
    );
  }

  if (summary.projects.names.length) {
    p.log.message(summary.projects.names.map((name) => `· ${name}`).join("\n"));
  }

  p.outro(summary.doctor.ok ? "PASS" : "FAIL — run `vulcanus doctor` for details");
  return summary.doctor.ok ? 0 : 1;
}
