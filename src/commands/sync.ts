import * as p from "@clack/prompts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDoctor } from "../doctor/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { reportDoctor } from "./doctor.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run("git", args, { cwd });
}

export interface SyncOptions {
  cwd?: string;
  topic?: string;
  /** Validate and stage without committing. */
  dryRun?: boolean;
}

export async function syncCommand(options: SyncOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    process.stderr.write("No vulcanus.json found. Run `vulcanus init` first.\n");
    return 2;
  }

  const manifest = await readManifest(vaultRoot);
  p.intro(`sync — ${manifest.vault.name}`);

  const report = await runDoctor(vaultRoot, manifest);
  if (!report.ok) {
    reportDoctor(report);
    p.outro(`FAIL — ${report.counts.error} error(s); nothing was committed.`);
    return 1;
  }
  p.log.success(`doctor passed — ${report.filesChecked} notes, ${report.linksChecked} links`);

  try {
    await git(vaultRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    p.outro("Not a Git repository; validation passed but nothing was committed.");
    return 0;
  }

  const status = await git(vaultRoot, ["status", "--porcelain"]);
  if (!status.stdout.trim()) {
    p.outro("Working tree is clean; nothing to commit.");
    return 0;
  }

  if (options.dryRun) {
    p.log.message(status.stdout.trim());
    p.outro("Dry run — nothing was committed.");
    return 0;
  }

  const topic = options.topic?.trim() || "memory update";
  await git(vaultRoot, ["add", "-A"]);
  await git(vaultRoot, ["commit", "-m", `${manifest.vault.name}: ${topic}`]);
  const hash = (await git(vaultRoot, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  p.log.success(`committed ${hash}`);

  let pushed = false;
  let pushError = "";
  try {
    await git(vaultRoot, ["remote", "get-url", "origin"]);
    await git(vaultRoot, ["push"]);
    pushed = true;
  } catch (error) {
    pushError = (error as Error).message.split("\n")[0];
  }

  // Report the push result exactly as it happened — never claim a push succeeded.
  if (pushed) {
    p.outro(`PASS — committed ${hash} and pushed.`);
  } else {
    p.outro(`PASS — committed ${hash}; not pushed (${pushError || "no origin configured"}).`);
  }
  return 0;
}
