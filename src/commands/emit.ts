import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadVaultNotes } from "../doctor/index.js";
import { BEGIN, END, type FilePlan } from "../emit/block.js";
import { planProject, staleReason, type EmitJob } from "../emit/plan.js";
import { EXIT, noVaultProblem, reportProblem } from "../errors.js";
import { buildPlan, type ProjectPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { today } from "../memory/lifecycle.js";
import { askConfirm } from "../prompts.js";
import * as p from "../ui.js";
import { isPrivate } from "../emit/content.js";
import { findProject } from "./project.js";

export interface EmitOptions {
  cwd?: string;
  /** Code repository to write into, instead of the project's `root` in vulcanus.json. */
  repo?: string;
  /** Show the difference, write nothing. */
  dryRun?: boolean;
  /** Write nothing; exit 1 when a file is stale or missing. */
  check?: boolean;
  /** With `check`: skip repositories that hold no vulcanus block yet (the pre-commit hook). */
  emittedOnly?: boolean;
  /** Include projects marked `visibility: private`. */
  includePrivate?: boolean;
  /** Approve creating files and appending to files without a block, without asking. */
  yes?: boolean;
  /** Whether a person can answer a question; defaults to the terminal's state. */
  interactive?: boolean;
  /** ISO date that decides what has expired; defaults to today. */
  on?: string;
}

function describe(file: FilePlan): string {
  const diff = [
    ...file.before.map((line) => `- ${line}`.trimEnd()),
    ...file.after.map((line) => `+ ${line}`.trimEnd()),
  ];
  return `${file.path}: ${file.state}\n${diff.join("\n")}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function emitCommand(
  projectQuery: string | undefined,
  options: EmitOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  if (!projectQuery && options.repo) {
    return reportProblem({
      what: "--repo needs a project.",
      why: "Several projects cannot share one repository folder.",
      fix: "vulcanus emit <project> --repo <dir>",
    });
  }
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus emit"));
  const manifest = await readManifest(vaultRoot);
  const all = buildPlan(manifest).allProjects;

  let chosen: ProjectPlan[];
  if (projectQuery) {
    const found = findProject(manifest, projectQuery);
    if (!found) {
      return reportProblem({
        what: `No project named "${projectQuery}" in ${manifest.vault.name}.`,
        why: `Known projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none yet"}.`,
        fix: "Use the name or id exactly as `vulcanus status` lists it.",
      });
    }
    chosen = all.filter((plan) => plan.project.id === found.id);
    if (isPrivate(manifest, found) && !options.includePrivate) {
      return reportProblem({
        what: `${found.name} is marked private (or sits under a private project), so nothing is written to its repository.`,
        why: "The agent files in a repository are often public; a private project stays out by default.",
        fix: `vulcanus emit ${found.id} --include-private`,
      });
    }
  } else {
    chosen = all.filter(
      (plan) =>
        typeof plan.project.root === "string" &&
        (options.includePrivate || !isPrivate(manifest, plan.project)),
    );
    if (chosen.length === 0 && options.emittedOnly) return EXIT.ok;
    if (chosen.length === 0) {
      return reportProblem({
        what: "No project has a repository folder to write into.",
        why: "Private projects are skipped, and the others list no `root` in vulcanus.json.",
        fix: "vulcanus emit <project> --repo <dir>",
      });
    }
  }

  const notes = await loadVaultNotes(vaultRoot, manifest);
  const on = options.on ?? today();
  const jobs: EmitJob[] = [];
  for (const plan of chosen) {
    const job = await planProject(plan, {
      vaultRoot,
      manifest,
      notes: notes.contents,
      cwd: start,
      repo: options.repo,
      on,
      includePrivate: Boolean(options.includePrivate),
    });
    if (!("files" in job)) {
      if (options.emittedOnly) continue;
      return reportProblem(job);
    }
    // A repository `emit` never wrote to is not this check's business.
    if (
      options.emittedOnly &&
      !job.files.some((file) => file.state === "update" || file.state === "unchanged")
    )
      continue;
    jobs.push(job);
  }

  const label = (job: EmitJob, file: FilePlan) =>
    jobs.length > 1 ? `${job.plan.project.name}: ${file.path}` : file.path;

  if (options.check) {
    const stale = jobs.flatMap((job) =>
      job.files
        .filter((file) => file.state !== "unchanged")
        .map((file) => {
          return `${label(job, file)}  ${staleReason(file)}`;
        }),
    );
    p.intro("emit --check");
    if (stale.length === 0) {
      p.outro("All agent files are current.");
      return EXIT.ok;
    }
    p.log.message(stale.map((line) => `✖ ${line}`).join("\n"));
    p.outro(`${plural(stale.length, "file")} out of date. Nothing was written; run vulcanus emit.`);
    return EXIT.failed;
  }

  const broken = jobs.flatMap((job) =>
    job.files.filter((file) => file.state === "broken").map((file) => ({ job, file })),
  );
  if (broken.length > 0) {
    return reportProblem(
      {
        what: `${broken.map(({ job, file }) => label(job, file)).join(", ")}: the vulcanus block markers are damaged.`,
        why: `${broken[0].file.reason}. Writing would have to guess where the block ends, and your text sits around it.`,
        fix: `Fix or remove ${BEGIN} and ${END} by hand, then run the command again.`,
      },
      EXIT.failed,
    );
  }

  p.intro("emit");
  for (const job of jobs) {
    p.log.info(`${job.plan.project.name} → ${job.repo}`);
    for (const file of job.files) {
      if (file.state === "unchanged") p.log.success(`${file.path}: unchanged`);
      else p.log.message(describe(file));
    }
  }
  const pending = jobs.flatMap((job) =>
    job.files.filter((file) => file.state !== "unchanged").map((file) => ({ job, file })),
  );
  if (pending.length === 0) {
    p.outro("No difference.");
    return EXIT.ok;
  }
  if (options.dryRun) {
    p.outro(`${plural(pending.length, "file")} would change. Nothing was written.`);
    return EXIT.ok;
  }

  // A file without markers is the operator's: creating or appending to it needs a yes.
  const needsYes = pending.some(({ file }) => file.state === "create" || file.state === "append");
  if (needsYes && !options.yes) {
    const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) {
      return reportProblem(
        {
          what: "Some files have no vulcanus block yet, and there is no terminal to ask for approval.",
          why: "Nothing is created or appended to without a yes. Nothing was written.",
          fix: [
            "vulcanus emit --dry-run   to review the difference",
            "vulcanus emit --yes       to approve it without a terminal",
            "run vulcanus emit in a terminal to approve it",
          ],
        },
        EXIT.failed,
      );
    }
    if (
      !(await askConfirm({
        message: `Write ${plural(pending.length, "file")}?`,
        initialValue: false,
      }))
    ) {
      p.outro("Nothing was written.");
      return EXIT.cancelled;
    }
  }
  for (const { job, file } of pending) {
    const target = resolve(job.repo, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text!);
  }
  p.outro(`Wrote ${plural(pending.length, "file")}.`);
  return EXIT.ok;
}
