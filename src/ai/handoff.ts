import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { reportDoctor } from "../commands/doctor.js";
import { runDoctor, type DoctorReport } from "../doctor/index.js";
import { messages, type Locale } from "../i18n.js";
import { buildPlan } from "../manifest/derive.js";
import type { VaultManifest } from "../manifest/schema.js";
import { askConfirm, askSelect, askText } from "../prompts.js";
import { detectAiClis, type DetectedCli } from "./clis.js";
import { buildHandoffPrompt, editableNotes } from "./prompt.js";
import { detectSourceDirectories, proposeSourceDirectories } from "./workdirs.js";

export interface HandoffAssignment {
  projectName: string;
  /** Absolute path of the codebase the AI will be started in. */
  sourceDir: string;
}

export interface HandoffPlan {
  cli: DetectedCli;
  assignments: HandoffAssignment[];
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function matchCli(clis: DetectedCli[], wanted: string): DetectedCli | undefined {
  const needle = wanted.trim().toLowerCase();
  return clis.find(
    (cli) =>
      cli.id === needle || cli.commands.includes(needle) || cli.label.toLowerCase() === needle,
  );
}

/** Ask for a directory until it exists, so a typo never reaches the spawn step. */
async function askSourceDir(message: string, hint: string, locale: Locale): Promise<string | null> {
  const t = messages(locale);
  for (;;) {
    const answered = (await askText({ message, placeholder: hint })).trim();
    if (!answered) return null;
    const path = resolve(expandHome(answered));
    if (isDirectory(path)) return path;
    p.log.warn(t.aiSourceMissing(path));
  }
}

/**
 * Choose the CLI and the codebase behind each project before anything is
 * written. Returns null when no AI CLI is installed, which is the caller's
 * signal to fall back to the questions rather than silently skipping detail.
 */
export async function planHandoff(
  projectNames: string[],
  locale: Locale,
  preferred?: string,
): Promise<HandoffPlan | null> {
  const t = messages(locale);

  const probing = p.spinner();
  probing.start(t.aiDetecting);
  const clis = detectAiClis();
  probing.stop(clis.length ? t.aiDetected(clis.length) : t.aiNoneDetected);

  if (clis.length === 0) {
    p.log.warn(t.aiNoneHint);
    return null;
  }

  let cli = preferred ? matchCli(clis, preferred) : undefined;
  if (preferred && !cli) p.log.warn(t.aiCliUnknown(preferred));

  if (!cli) {
    const chosen = await askSelect({
      message: t.aiCliQuestion,
      options: clis.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.path })),
    });
    cli = clis.find((entry) => entry.id === chosen)!;
  }

  const scanning = p.spinner();
  scanning.start(t.aiScanning);
  const known = await detectSourceDirectories();
  scanning.stop(t.aiScanned(known.length));

  const assignments: HandoffAssignment[] = [];
  for (const projectName of projectNames) {
    const proposals = proposeSourceDirectories(projectName, known);

    let sourceDir: string | null = null;
    if (proposals.length > 0) {
      const choice = await askSelect({
        message: t.aiSourceQuestion(projectName),
        options: [
          ...proposals.map((dir) => ({ value: dir, label: dir })),
          { value: "__other__", label: t.aiSourceOther },
          { value: "__skip__", label: t.aiSourceSkip },
        ],
        initialValue: proposals[0],
      });
      if (choice === "__other__") {
        sourceDir = await askSourceDir(t.aiSourceQuestion(projectName), t.aiSourceHint, locale);
      } else if (choice !== "__skip__") {
        sourceDir = choice;
      }
    } else {
      sourceDir = await askSourceDir(t.aiSourceQuestion(projectName), t.aiSourceHint, locale);
    }

    if (sourceDir) assignments.push({ projectName, sourceDir });
    else p.log.info(t.aiSkipped(projectName));
  }

  return { cli, assignments };
}

function spawnCli(cli: DetectedCli, prompt: string, cwd: string): Promise<number> {
  return new Promise((settle) => {
    const child = spawn(cli.path, cli.args(prompt), { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      p.log.error(`${cli.label}: ${error.message}`);
      settle(-1);
    });
    child.on("close", (code) => settle(code ?? 0));
  });
}

/**
 * Hand the terminal to the chosen CLI, one project at a time. Each session is
 * confirmed on its own — this gives another program the operator's shell — and
 * validated afterwards so a bad edit surfaces immediately. The last report is
 * returned so the command's own verdict reflects what the AI left behind.
 */
export async function runHandoff(
  vaultRoot: string,
  manifest: VaultManifest,
  handoff: HandoffPlan,
  locale: Locale,
): Promise<DoctorReport | null> {
  const t = messages(locale);
  const plan = buildPlan(manifest);
  let last: DoctorReport | null = null;

  for (const assignment of handoff.assignments) {
    const projectPlan = plan.allProjects.find(
      (entry) => entry.project.name === assignment.projectName,
    );
    if (!projectPlan) continue;
    if (!existsSync(assignment.sourceDir)) {
      p.log.warn(t.aiSourceMissing(assignment.sourceDir));
      continue;
    }

    const notes = editableNotes(vaultRoot, projectPlan);
    p.note(
      t.aiHandoffSummary(
        handoff.cli.label,
        assignment.sourceDir,
        notes.map((note) => note.path),
      ),
      t.aiHandoffTitle(assignment.projectName),
    );

    const go = await askConfirm({
      message: t.aiHandoffConfirm(handoff.cli.label),
      initialValue: true,
    });
    if (!go) {
      p.log.info(t.aiSkipped(assignment.projectName));
      continue;
    }

    const prompt = buildHandoffPrompt(plan, vaultRoot, {
      project: projectPlan,
      sourceDir: assignment.sourceDir,
    });
    const code = await spawnCli(handoff.cli, prompt, assignment.sourceDir);
    p.log.info(t.aiSessionExited(handoff.cli.label, code));

    const validating = p.spinner();
    validating.start(t.aiRevalidating(assignment.projectName));
    const report = await runDoctor(vaultRoot, manifest);
    validating.stop(
      report.ok
        ? t.doctorPassed(report.filesChecked, report.linksChecked)
        : t.doctorFailed(report.counts.error),
    );
    if (!report.ok) reportDoctor(report);
    last = report;
  }

  return last;
}
