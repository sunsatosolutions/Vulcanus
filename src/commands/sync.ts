import * as p from "../ui.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDoctor } from "../doctor/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { reportDoctor } from "./doctor.js";
import { noVaultProblem, reportProblem } from "../errors.js";
import { watchVault } from "./watch.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run("git", args, { cwd });
}

export interface SyncOptions {
  cwd?: string;
  topic?: string;
  /** Validate and stage without committing. */
  dryRun?: boolean;
  json?: boolean;
  /** Keep running: revalidate and re-sync whenever a note changes. */
  watch?: boolean;
}

export interface SyncSummary {
  vault: string;
  root: string;
  /** The whole run succeeded: validation passed and nothing was left broken. */
  ok: boolean;
  doctor: { ok: boolean; errors: number; warnings: number; filesChecked: number };
  /** Files git reported as changed before the commit. */
  changes: string[];
  committed: string | null;
  pushed: boolean;
  /** Why the push did not happen, when it did not. */
  pushError: string | null;
  dryRun: boolean;
  /** Absent git or a clean tree are outcomes, not failures — say which. */
  reason: "committed" | "clean" | "not-a-repository" | "dry-run" | "doctor-failed";
}

/** The commit/push half, with no printing, so `--watch` can reuse it. */
export async function runSync(vaultRoot: string, options: SyncOptions = {}): Promise<SyncSummary> {
  const manifest = await readManifest(vaultRoot);
  const report = await runDoctor(vaultRoot, manifest);

  const base: SyncSummary = {
    vault: manifest.vault.name,
    root: vaultRoot,
    ok: report.ok,
    doctor: {
      ok: report.ok,
      errors: report.counts.error,
      warnings: report.counts.warning,
      filesChecked: report.filesChecked,
    },
    changes: [],
    committed: null,
    pushed: false,
    pushError: null,
    dryRun: Boolean(options.dryRun),
    reason: "doctor-failed",
  };

  if (!report.ok) return base;

  try {
    await git(vaultRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ...base, reason: "not-a-repository" };
  }

  const status = await git(vaultRoot, ["status", "--porcelain"]);
  const changes = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (changes.length === 0) return { ...base, reason: "clean" };
  if (options.dryRun) return { ...base, changes, reason: "dry-run" };

  const topic = options.topic?.trim() || "memory update";
  await git(vaultRoot, ["add", "-A"]);
  await git(vaultRoot, ["commit", "-m", `${manifest.vault.name}: ${topic}`]);
  const hash = (await git(vaultRoot, ["rev-parse", "--short", "HEAD"])).stdout.trim();

  let pushed = false;
  let pushError: string | null = null;
  try {
    await git(vaultRoot, ["remote", "get-url", "origin"]);
    await git(vaultRoot, ["push"]);
    pushed = true;
  } catch (error) {
    pushError = (error as Error).message.split("\n")[0];
  }

  return { ...base, changes, committed: hash, pushed, pushError, reason: "committed" };
}

function reportSync(summary: SyncSummary): void {
  switch (summary.reason) {
    case "doctor-failed":
      p.outro(`FAIL — ${summary.doctor.errors} error(s); nothing was committed.`);
      return;
    case "not-a-repository":
      p.outro("Not a Git repository; validation passed but nothing was committed.");
      return;
    case "clean":
      p.outro("Working tree is clean; nothing to commit.");
      return;
    case "dry-run":
      p.log.message(summary.changes.join("\n"));
      p.outro("Dry run — nothing was committed.");
      return;
    case "committed":
      // Report the push result exactly as it happened — never claim a push succeeded.
      p.outro(
        summary.pushed
          ? `PASS — committed ${summary.committed} and pushed.`
          : `PASS — committed ${summary.committed}; not pushed (${summary.pushError ?? "no origin configured"}).`,
      );
      return;
  }
}

export async function syncCommand(options: SyncOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    return reportProblem(noVaultProblem(options.cwd ?? process.cwd(), "vulcanus sync"));
  }

  if (options.watch) return watchVault(vaultRoot, options);

  const manifest = await readManifest(vaultRoot);
  if (!options.json) p.intro(`sync — ${manifest.vault.name}`);

  const summary = await runSync(vaultRoot, options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary.ok ? 0 : 1;
  }

  if (!summary.doctor.ok) {
    reportDoctor(await runDoctor(vaultRoot, manifest));
  } else {
    p.log.success(`doctor passed — ${summary.doctor.filesChecked} notes`);
  }
  for (const change of summary.changes) p.log.debug(change);
  reportSync(summary);
  return summary.ok ? 0 : 1;
}
