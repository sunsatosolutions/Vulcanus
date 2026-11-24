import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runDoctor } from "../doctor/index.js";
import { noVaultProblem, reportProblem } from "../errors.js";
import { messages } from "../i18n.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { openVault } from "../mcp/tools.js";
import { compareWithVault, type MemoryCandidate } from "../memory/extract.js";
import {
  capPerProject,
  DEFAULT_SINCE,
  harvestCandidates,
  HarvestError,
} from "../memory/harvest.js";
import { reviewCandidates, vaultSections } from "../memory/inbox.js";
import { askSelect, setPromptLocale } from "../prompts.js";
import * as p from "../ui.js";
import { gitOrNull } from "../util/git.js";
import { expandHome } from "../util/paths.js";

export interface HarvestOptions {
  cwd?: string;
  /** Code repository to read; defaults to the one root every project shares. */
  code?: string;
  /** `30d` for a number of days, or a tag or commit to read from. */
  since?: string;
  /** Print only the counts. */
  json?: boolean;
}

/** The one repository the projects' `root`s point into, if they agree. */
async function sharedRoot(
  vaultRoot: string,
  roots: Array<string | undefined>,
): Promise<string | undefined> {
  const tops = new Set<string>();
  for (const root of roots) {
    if (typeof root !== "string") continue;
    const dir = resolve(vaultRoot, expandHome(root));
    const top = existsSync(dir) ? await gitOrNull(dir, ["rev-parse", "--show-toplevel"]) : null;
    if (top) tops.add(top.trim());
  }
  return tops.size === 1 ? [...tops][0] : undefined;
}

export async function harvestCommand(options: HarvestOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus harvest"));

  const manifest = await readManifest(vaultRoot);
  const locale = manifest.vault.language;
  setPromptLocale(locale);
  const t = messages(locale);

  const codeDir = options.code
    ? resolve(start, expandHome(options.code))
    : await sharedRoot(
        vaultRoot,
        manifest.projects.map((project) => project.root),
      );
  if (!codeDir || !existsSync(codeDir) || !statSync(codeDir).isDirectory()) {
    return reportProblem({
      what: codeDir ? `${codeDir} is not a folder.` : "No code repository to harvest.",
      why: "harvest reads commit messages from the code repository, which is not the vault.",
      fix: "vulcanus harvest --code <repository>   (or set the same `root` on your projects)",
    });
  }

  const handle = await openVault(vaultRoot);
  if (handle.plan.allProjects.length === 0) {
    p.log.warn(t.memoryNoProjects);
    return 0;
  }

  p.intro(`harvest — ${manifest.vault.name}`);
  const spinner = p.spinner();
  spinner.start(t.harvestReading);
  let found: MemoryCandidate[];
  try {
    found = (await harvestCandidates(handle.plan, codeDir, options.since ?? DEFAULT_SINCE))
      .candidates;
  } catch (error) {
    spinner.stop("");
    if (!(error instanceof HarvestError)) throw error;
    return reportProblem({
      what: "Could not read the commit history.",
      why: error.message,
      fix: "vulcanus harvest --code <git repository> [--since 30d|<tag>]",
    });
  }
  spinner.stop(t.harvestReading);

  // A commit that did not point at one project is the operator's call. A
  // directory name never becomes a project.
  const projects = handle.plan.allProjects.map((entry) => entry.project.name);
  const assigned: MemoryCandidate[] = [];
  for (const candidate of found) {
    if (candidate.project) {
      assigned.push(candidate);
      continue;
    }
    const choice = await askSelect<string>({
      message: t.harvestPickProject(candidate.text),
      options: [
        ...projects.map((name) => ({ value: name, label: name })),
        { value: "", label: t.harvestNoProject },
      ],
      initialValue: "",
    });
    if (choice) assigned.push({ ...candidate, project: choice });
  }

  const candidates = compareWithVault(capPerProject(assigned), await vaultSections(handle), {
    keepKnown: true,
  });

  let accepted = 0;
  let skipped = 0;
  if (candidates.length === 0) {
    p.log.info(t.memoryNone);
  } else {
    p.log.step(
      t.memoryFound(candidates.length, new Set(candidates.map((entry) => entry.project)).size),
    );
    const outcome = await reviewCandidates(handle, candidates, "git", t);
    accepted = outcome.accepted;
    skipped = outcome.skipped;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ candidates: candidates.length, accepted, skipped })}\n`,
    );
  } else {
    p.log.success(t.harvestDone(candidates.length, accepted));
  }
  if (accepted === 0) {
    p.outro("Done.");
    return 0;
  }
  const report = await runDoctor(vaultRoot, await readManifest(vaultRoot), {
    codeDir,
  });
  p.outro(report.ok ? "PASS" : "FAIL — run `vulcanus doctor` for details");
  return report.ok ? 0 : 1;
}
