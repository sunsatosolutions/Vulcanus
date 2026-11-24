import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectPlan } from "../manifest/derive.js";
import { COMMIT_ID, git, gitOrNull, literalPath } from "../util/git.js";
import { expandHome } from "../util/paths.js";
import { parseSections, sectionState, today, type MemorySection } from "./lifecycle.js";

/**
 * Code drift: a section that names the commit and the files its reasoning came
 * from (`commit::` and `paths::`) is checked against the code as it is now.
 *
 * Only content counts. Whitespace-only edits and blank-line changes are not a
 * reason to doubt a decision, so the comparison ignores them. The vault is a
 * separate git repository from the code; everything here reads the code
 * repository and writes nothing.
 */

export interface CodeChange {
  section: MemorySection;
  kind: "changed" | "unverified";
  /** Files whose content differs between the commit and HEAD. */
  files: string[];
  /** Why a section could not be checked; empty for `changed`. */
  reason: string;
}

/** Where a project's code lives: `--code` for one run, else `root` in the manifest. */
export function codeDirOf(
  vaultRoot: string,
  project: ProjectPlan,
  override?: string,
): string | undefined {
  if (override) return resolve(override);
  const root = project.project.root;
  return typeof root === "string" ? resolve(vaultRoot, expandHome(root)) : undefined;
}

/** Every note of a project that may carry sections with code fields. */
export function projectNotePaths(project: ProjectPlan): string[] {
  return [
    project.capsule,
    project.hub,
    project.context,
    project.decisions,
    project.rules,
    ...project.specialized.map((entry) => entry.note),
  ].map((note) => note.path);
}

/** Live sections of a project's notes that carry both `commit::` and `paths::`. */
export async function codeBackedSections(
  vaultRoot: string,
  project: ProjectPlan,
  read: (path: string) => Promise<string | undefined> = async (path) => {
    const absolute = resolve(vaultRoot, path);
    return existsSync(absolute) ? readFile(absolute, "utf8") : undefined;
  },
  on: string = today(),
): Promise<MemorySection[]> {
  const found: MemorySection[] = [];
  for (const path of projectNotePaths(project)) {
    const text = await read(path);
    if (text === undefined) continue;
    for (const section of parseSections(path, text)) {
      // A superseded or expired section is history already; it needs no second flag.
      if (section.commit && section.paths?.length && sectionState(section, on) === "live") {
        found.push(section);
      }
    }
  }
  return found;
}

async function filesChanged(codeDir: string, commit: string, paths: string[]): Promise<string[]> {
  const out = await git(codeDir, [
    "diff",
    "--ignore-all-space",
    "--ignore-blank-lines",
    "--numstat",
    "--no-renames",
    "-z",
    commit,
    "HEAD",
    "--",
    ...paths.map(literalPath),
  ]);
  // --numstat prints nothing for a file whose only change was whitespace;
  // --name-only would list it, which is the difference this check exists for.
  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.split("\t").slice(2).join("\t"));
}

/**
 * Check each section against `codeDir` (undefined when the project has no
 * code repository). Sections that changed and sections that could not be
 * checked are returned; the rest are fine and left out.
 */
export async function checkCodeDrift(
  codeDir: string | undefined,
  sections: MemorySection[],
): Promise<CodeChange[]> {
  const out: CodeChange[] = [];
  const unverified = (section: MemorySection, reason: string) =>
    out.push({ section, kind: "unverified", files: [], reason });

  const usable = codeDir && existsSync(codeDir) && statSync(codeDir).isDirectory();
  const isRepo = usable && (await gitOrNull(codeDir, ["rev-parse", "--git-dir"])) !== null;

  for (const section of sections) {
    const commit = section.commit ?? "";
    if (!codeDir) {
      unverified(section, "the project has no source root; set `root` in vulcanus.json");
    } else if (!usable) {
      unverified(section, `${codeDir} is not a folder`);
    } else if (!isRepo) {
      unverified(section, `${codeDir} is not a git repository`);
    } else if (!COMMIT_ID.test(commit)) {
      unverified(section, `commit:: ${commit} is not a commit id`);
    } else if ((await gitOrNull(codeDir, ["cat-file", "-e", `${commit}^{commit}`])) === null) {
      unverified(section, `commit ${commit.slice(0, 7)} was not found in ${codeDir}`);
    } else {
      const files = await filesChanged(codeDir, commit, section.paths ?? []);
      if (files.length) out.push({ section, kind: "changed", files, reason: "" });
    }
  }
  return out;
}

/** Sections of one project whose code changed, for recall and search. */
export async function changedSections(
  vaultRoot: string,
  project: ProjectPlan,
): Promise<CodeChange[]> {
  const sections = await codeBackedSections(vaultRoot, project);
  if (sections.length === 0) return [];
  const dir = codeDirOf(vaultRoot, project);
  if (!dir) return [];
  return (await checkCodeDrift(dir, sections)).filter((entry) => entry.kind === "changed");
}
