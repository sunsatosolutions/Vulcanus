import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EXIT, noVaultProblem, reportProblem, type Problem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import {
  appendDecision,
  appendRule,
  LifecycleTargetError,
  markSection,
  openVault,
  type ReviewMark,
} from "../mcp/tools.js";
import { findSection, parseSections, sectionState, today } from "../memory/lifecycle.js";
import { findStale, type StaleSection } from "../memory/staleness.js";
import { askSelect, askText } from "../prompts.js";
import * as p from "../ui.js";
import { badDaysProblem, parseDays, selectProjects, unknownProjectProblem } from "./stale.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const run = promisify(execFile);

export const REVIEW_ACTIONS = ["keep", "supersede", "archive", "evergreen"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ReviewOptions {
  cwd?: string;
  days?: number | string;
  /** Review this one section instead of walking the stale list. */
  section?: string;
  action?: string;
  /** Heading of the replacement, for `supersede`. */
  title?: string;
  /** Text of the replacement, for `supersede`. */
  decision?: string;
  json?: boolean;
  /** ISO date recorded in the section fields; injectable for tests. */
  today?: string;
}

export interface ReviewOutcome {
  project: string;
  note: string;
  heading: string;
  action: ReviewAction;
  /** Short hash of the git commit the review wrote; null when it could not be committed. */
  commit: string | null;
  /** Why there is no commit. */
  uncommitted?: string;
  /** Heading of the replacement section, for `supersede`. */
  replacedBy?: string;
}

/** Commit exactly the paths a review touched, leaving anything else staged or dirty alone. */
async function commitPaths(
  vaultRoot: string,
  paths: string[],
  message: string,
): Promise<{ commit: string } | { reason: string }> {
  try {
    await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: vaultRoot });
  } catch {
    return { reason: "the vault is not a git repository" };
  }
  try {
    await run("git", ["add", "--", ...paths], { cwd: vaultRoot });
    await run("git", ["commit", "-m", message, "--", ...paths], { cwd: vaultRoot });
    const { stdout } = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: vaultRoot });
    return { commit: stdout.trim() };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    return { reason: `git commit failed${stderr ? `: ${stderr.split("\n")[0]}` : ""}` };
  }
}

function usage(what: string, fix: string): Problem {
  return { what, why: "review writes to the notes, so every choice must be explicit.", fix };
}

export async function reviewCommand(
  projectQuery: string | undefined,
  options: ReviewOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus review"));

  const days = parseDays(options.days);
  if (days === null) return reportProblem(badDaysProblem(options.days));
  const action = options.action as ReviewAction | undefined;
  if (action !== undefined && !REVIEW_ACTIONS.includes(action)) {
    return reportProblem(
      usage(`Unknown action "${options.action}".`, `--action ${REVIEW_ACTIONS.join("|")}`),
    );
  }
  if ((options.section === undefined) !== (action === undefined)) {
    return reportProblem(
      usage(
        "--section and --action go together.",
        "vulcanus review <project> --section <heading> --action keep",
      ),
    );
  }
  if (options.section !== undefined && !projectQuery) {
    return reportProblem(
      usage(
        "--section needs a project.",
        "vulcanus review <project> --section <heading> --action keep",
      ),
    );
  }

  const manifest = await readManifest(vaultRoot);
  const targets = selectProjects(manifest, projectQuery);
  if (!targets) return reportProblem(unknownProjectProblem(manifest, projectQuery!));
  const handle = await openVault(vaultRoot);
  const on = options.today ?? today();

  // The sections to decide on: the one named, or every stale one.
  let queue: StaleSection[];
  if (options.section !== undefined) {
    const plan = targets[0];
    queue = [];
    for (const note of [plan.decisions, plan.rules]) {
      const text = await readFile(resolve(vaultRoot, note.path), "utf8").catch(() => "");
      const found = findSection(parseSections(note.path, text), options.section);
      if (found && sectionState(found, on) === "live") {
        queue.push({
          project: plan.project.name,
          note: note.path,
          heading: found.heading,
          line: found.line,
          lastChanged: "",
          ageDays: 0,
        });
        break;
      }
    }
    if (queue.length === 0) {
      return reportProblem({
        what: `No live section "${options.section}" in ${plan.project.name}'s Decisions or Rules.`,
        why: "Superseded and expired sections are history and are not reviewed.",
        fix: "vulcanus stale to list what is due.",
      });
    }
  } else {
    queue = (await findStale(vaultRoot, targets, days)).projects.flatMap((entry) => entry.stale);
  }

  if (!options.json) p.intro(`review — ${manifest.vault.name}`);
  if (queue.length === 0) {
    if (options.json) process.stdout.write("[]\n");
    else p.outro(`Nothing older than ${days} days.`);
    return EXIT.ok;
  }

  const outcomes: ReviewOutcome[] = [];
  let failed = false;
  for (const item of queue) {
    const plan = targets.find((entry) => entry.project.name === item.project)!;
    const kind = item.note === plan.rules.path ? "rules" : "decisions";
    const label = `${item.note}:${item.line} "${item.heading}"`;

    let choice: ReviewAction | "skip" | undefined = action;
    if (!choice) {
      choice = await askSelect<ReviewAction | "skip">({
        message: `${label} — last changed ${item.lastChanged} (${item.ageDays} days before the project's last movement)`,
        options: [
          { value: "keep", label: "keep", hint: "still true; records reviewed::" },
          { value: "supersede", label: "supersede", hint: "write its replacement" },
          { value: "archive", label: "archive", hint: "no longer valid; kept as history" },
          { value: "evergreen", label: "evergreen", hint: "never stale" },
          { value: "skip", label: "skip" },
        ],
      });
    }
    if (choice === "skip") continue;

    try {
      let replacedBy: string | undefined;
      let touched: string;
      if (choice === "supersede") {
        const title =
          options.title ??
          (await askText({ message: "Title of the replacement section", required: true }));
        const text =
          options.decision ?? (await askText({ message: "What now holds", required: true }));
        const written =
          kind === "rules"
            ? await appendRule(handle, item.project, title, text, { supersedes: item.heading, on })
            : await appendDecision(handle, item.project, title, text, undefined, {
                supersedes: item.heading,
                on,
              });
        if (!written)
          throw new LifecycleTargetError(`${item.note} is missing; nothing was written.`);
        replacedBy = "rule" in written ? written.rule : written.heading;
        touched = written.path;
      } else {
        const mark: ReviewMark = choice;
        const written = await markSection(handle, item.project, kind, item.heading, mark, on);
        if (!written)
          throw new LifecycleTargetError(`${item.note} is missing; nothing was written.`);
        touched = written.path;
      }
      const commit = await commitPaths(
        vaultRoot,
        [touched],
        `review(${item.project}): ${choice} "${item.heading}"`,
      );
      const outcome: ReviewOutcome = {
        project: item.project,
        note: item.note,
        heading: item.heading,
        action: choice,
        commit: "commit" in commit ? commit.commit : null,
        ...("reason" in commit ? { uncommitted: commit.reason } : {}),
        ...(replacedBy ? { replacedBy } : {}),
      };
      outcomes.push(outcome);
      if (!options.json) {
        p.log.success(
          `${choice} "${item.heading}"${replacedBy ? ` → "${replacedBy}"` : ""} — ${
            outcome.commit
              ? `commit ${outcome.commit}`
              : `written, not committed (${outcome.uncommitted})`
          }`,
        );
      }
    } catch (error) {
      if (!(error instanceof LifecycleTargetError)) throw error;
      failed = true;
      p.log.error(`${label}: ${error.message}`);
    }
  }

  if (options.json) process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
  else p.outro(`${outcomes.length} reviewed.`);
  return failed ? EXIT.failed : EXIT.ok;
}
