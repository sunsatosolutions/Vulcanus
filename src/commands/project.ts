import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runDoctor } from "../doctor/index.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { removeBulletsLinking, removeSection } from "../generate/patch.js";
import { buildPlan, type ProjectPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest, writeManifest } from "../manifest/io.js";
import { validateManifest, type VaultManifest } from "../manifest/schema.js";
import { safeFileName } from "../util/text.js";
import { reportDoctor } from "./doctor.js";

export interface ProjectCommandOptions {
  cwd?: string;
  json?: boolean;
}

interface Located {
  vaultRoot: string;
  manifest: VaultManifest;
  plan: ProjectPlan;
}

/** Resolve a project by id or name, case-insensitively. */
function findProject(manifest: VaultManifest, query: string) {
  const needle = query.trim().toLowerCase();
  return manifest.projects.find(
    (project) => project.id.toLowerCase() === needle || project.name.toLowerCase() === needle,
  );
}

async function locate(cwd: string | undefined, name: string): Promise<Located | number> {
  const start = cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) {
    process.stderr.write(`No vulcanus.json found in ${start} or any parent directory.\n`);
    return 2;
  }

  const manifest = await readManifest(vaultRoot);
  const project = findProject(manifest, name);
  if (!project) {
    process.stderr.write(
      `No project named "${name}". Projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none"}.\n`,
    );
    return 2;
  }

  const plan = buildPlan(manifest).allProjects.find((entry) => entry.project.id === project.id)!;
  return { vaultRoot, manifest, plan };
}

/** All wikilink names owned by a project cluster (its own notes only). */
function noteNames(plan: ProjectPlan): string[] {
  return plan.notes.map((note) => note.name);
}

async function patchFile(
  vaultRoot: string,
  path: string,
  edit: (content: string) => { content: string; changed: boolean },
): Promise<boolean> {
  const absolute = resolve(vaultRoot, path);
  if (!existsSync(absolute)) return false;
  const result = edit(await readFile(absolute, "utf8"));
  if (result.changed) await writeFile(absolute, result.content, "utf8");
  return result.changed;
}

/** A unique destination under `_archive/`, so two removals never collide. */
async function archiveDestination(vaultRoot: string, dirName: string): Promise<string> {
  const base = resolve(vaultRoot, "_archive");
  await mkdir(base, { recursive: true });
  let candidate = resolve(base, dirName);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = resolve(base, `${dirName}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

/**
 * Remove a project from the graph. Its notes are moved to `_archive/`, never
 * deleted: memory is expensive to rebuild and cheap to keep.
 */
export async function removeProjectCommand(
  name: string,
  options: ProjectCommandOptions = {},
): Promise<number> {
  const located = await locate(options.cwd, name);
  if (typeof located === "number") return located;
  const { vaultRoot, manifest, plan } = located;

  if (plan.children.length > 0) {
    process.stderr.write(
      `${plan.project.name} has sub-projects (${plan.children
        .map((child) => child.project.name)
        .join(", ")}). Remove or re-parent them first.\n`,
    );
    return 2;
  }

  p.intro(`remove project — ${plan.project.name}`);

  const next: VaultManifest = {
    ...manifest,
    projects: manifest.projects.filter((project) => project.id !== plan.project.id),
  };
  await writeManifest(vaultRoot, next);

  // Park the cluster under _archive/ before regenerating anything.
  const source = resolve(vaultRoot, plan.dir);
  let archivedTo: string | null = null;
  if (existsSync(source)) {
    const destination = await archiveDestination(vaultRoot, plan.dir.split("/").pop()!);
    await rename(source, destination);
    archivedTo = destination;
  }

  // Managed files (Index tree, hubs the CLI owns) are regenerated; the
  // operator-owned Recall Map and parent hub are edited surgically.
  const nextPlan = buildPlan(next);
  const { files } = generateFiles(next);
  await writeFiles(vaultRoot, files, { repair: true });

  const patched: string[] = [];
  const links = noteNames(plan);
  if (
    await patchFile(vaultRoot, nextPlan.recallMap.path, (content) => {
      const section = removeSection(content, `### ${plan.project.name}`);
      const bullets = removeBulletsLinking(section.content, links);
      return { content: bullets.content, changed: section.changed || bullets.changed };
    })
  ) {
    patched.push(nextPlan.recallMap.path);
  }
  if (await patchFile(vaultRoot, plan.parentLink.path, (c) => removeBulletsLinking(c, links))) {
    patched.push(plan.parentLink.path);
  }

  const report = await runDoctor(vaultRoot, next);
  if (!report.ok) reportDoctor(report);

  if (archivedTo) p.log.info(`Notes moved to ${archivedTo}`);
  if (patched.length) p.log.info(`Unlinked from: ${patched.join(", ")}`);
  p.outro(
    report.ok
      ? `${plan.project.name} removed — vault still validates.`
      : `${plan.project.name} removed — run \`vulcanus doctor\` for remaining references.`,
  );
  return report.ok ? 0 : 1;
}

/** Change a project's status without touching its notes. */
export async function archiveProjectCommand(
  name: string,
  options: ProjectCommandOptions & { restore?: boolean } = {},
): Promise<number> {
  const located = await locate(options.cwd, name);
  if (typeof located === "number") return located;
  const { vaultRoot, manifest, plan } = located;

  const status = options.restore ? "active" : "archived";
  if (plan.project.status === status) {
    process.stderr.write(`${plan.project.name} is already ${status}.\n`);
    return 0;
  }

  const next: VaultManifest = {
    ...manifest,
    projects: manifest.projects.map((project) =>
      project.id === plan.project.id ? { ...project, status } : project,
    ),
  };
  await writeManifest(vaultRoot, next);

  // Refresh managed files so the Index reflects the new status.
  const { files } = generateFiles(next);
  await writeFiles(vaultRoot, files, { repair: true });

  p.intro(`archive project — ${plan.project.name}`);
  p.outro(
    options.restore
      ? `${plan.project.name} is active again.`
      : `${plan.project.name} archived — notes stay in place, status is "archived".`,
  );
  return 0;
}

/**
 * Rename a project everywhere at once: manifest, folder, note filenames, and
 * every wikilink or heading that used the old note names.
 */
export async function renameProjectCommand(
  oldName: string,
  newName: string,
  options: ProjectCommandOptions = {},
): Promise<number> {
  const located = await locate(options.cwd, oldName);
  if (typeof located === "number") return located;
  const { vaultRoot, manifest, plan } = located;

  const trimmed = newName.trim();
  if (!trimmed || !safeFileName(trimmed)) {
    process.stderr.write(`"${newName}" is not a usable project name.\n`);
    return 2;
  }
  if (findProject(manifest, trimmed)) {
    process.stderr.write(`A project named "${trimmed}" already exists.\n`);
    return 2;
  }

  const next: VaultManifest = {
    ...manifest,
    projects: manifest.projects.map((project) =>
      project.id === plan.project.id
        ? {
            ...project,
            name: trimmed,
            // A trigger that was just the old name should follow the rename.
            triggers: project.triggers.map((trigger) =>
              trigger.toLowerCase() === plan.project.name.toLowerCase()
                ? trimmed.toLowerCase()
                : trigger,
            ),
          }
        : project,
    ),
  };
  const issues = validateManifest(next).filter((issue) => issue.level === "error");
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`${issue.message}\n`);
    return 2;
  }

  p.intro(`rename project — ${plan.project.name} → ${trimmed}`);

  const nextPlan = buildPlan(next).allProjects.find(
    (entry) => entry.project.id === plan.project.id,
  )!;

  // 1. Move the cluster directory (a fixed dirName means it does not move).
  const oldDir = resolve(vaultRoot, plan.dir);
  const newDir = resolve(vaultRoot, nextPlan.dir);
  if (oldDir !== newDir && existsSync(oldDir)) {
    await mkdir(dirname(newDir), { recursive: true });
    await rename(oldDir, newDir);
  }

  // 2. Rename the note files inside the (possibly moved) directory.
  const renames = plan.notes.map((note, index) => ({
    from: note.name,
    to: nextPlan.notes[index].name,
  }));
  for (const [index, note] of plan.notes.entries()) {
    const from = resolve(newDir, `${note.name}.md`);
    const to = resolve(vaultRoot, nextPlan.notes[index].path);
    if (from !== to && existsSync(from)) await rename(from, to);
  }

  // 3. Rewrite references vault-wide: wikilinks, headings, and the recall
  //    section heading all carry the note names or the project name itself.
  const pairs: Array<[string, string]> = [
    ...renames.map((entry): [string, string] => [entry.from, entry.to]),
    [`### ${plan.project.name}`, `### ${trimmed}`],
    [`project: ${plan.project.name}`, `project: ${trimmed}`],
  ];

  const dirs = [next.structure.systemDir, next.structure.projectsDir];
  const touched: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const absolute = resolve(vaultRoot, dir);
    if (!existsSync(absolute)) return;
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const child = resolve(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(`${dir}/${entry.name}`);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const before = await readFile(child, "utf8");
        let after = before;
        for (const [from, to] of pairs) after = after.split(from).join(to);
        if (after !== before) {
          await writeFile(child, after, "utf8");
          touched.push(`${dir}/${entry.name}`);
        }
      }
    }
  };
  for (const dir of dirs) await walk(dir);

  // 4. Persist the manifest and refresh everything the CLI owns.
  await writeManifest(vaultRoot, next);
  const { files } = generateFiles(next);
  await writeFiles(vaultRoot, files, { repair: true });

  const report = await runDoctor(vaultRoot, next);
  if (!report.ok) reportDoctor(report);

  p.log.info(`${touched.length} note(s) relinked`);
  p.outro(
    report.ok
      ? `${trimmed} — vault still validates.`
      : `Renamed, but validation found issues — run \`vulcanus doctor\`.`,
  );
  return report.ok ? 0 : 1;
}
