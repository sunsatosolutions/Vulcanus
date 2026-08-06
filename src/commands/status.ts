import * as p from "@clack/prompts";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { runDoctor } from "../doctor/index.js";
import { buildPlan } from "../manifest/derive.js";
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

  if (summary.projects.names.length) {
    p.log.message(summary.projects.names.map((name) => `· ${name}`).join("\n"));
  }

  p.outro(summary.doctor.ok ? "PASS" : "FAIL — run `vulcanus doctor` for details");
  return summary.doctor.ok ? 0 : 1;
}
