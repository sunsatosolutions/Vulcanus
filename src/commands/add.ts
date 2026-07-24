import * as p from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { planHandoff, runHandoff } from "../ai/handoff.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest, writeManifest } from "../manifest/io.js";
import {
  KNOWN_SPECIALIZED_NOTES,
  makeProjectId,
  type ProjectGroup,
  type ProjectNode,
  type VaultManifest,
} from "../manifest/schema.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { ensureBulletUnderHeading, insertSectionBefore } from "../generate/patch.js";
import { recallRouteSection } from "../generate/system.js";
import { runDoctor } from "../doctor/index.js";
import { messages, type Locale } from "../i18n.js";
import { askMultiselect, askSelect, askText, setPromptLocale, splitList } from "../prompts.js";
import { slugify } from "../util/text.js";
import { reportDoctor } from "./doctor.js";

export interface ApplyResult {
  created: string[];
  patched: string[];
  ok: boolean;
}

/**
 * Add projects to an existing vault: write the manifest, generate the new
 * clusters, refresh generated files, and patch the operator-owned Recall Map and
 * parent hubs in place rather than rewriting them.
 */
export async function applyProjects(
  vaultRoot: string,
  manifest: VaultManifest,
  additions: { projects: ProjectNode[]; groups: ProjectGroup[] },
): Promise<ApplyResult> {
  const existingGroupIds = new Set(manifest.groups.map((group) => group.id));
  const merged: VaultManifest = {
    ...manifest,
    groups: [
      ...manifest.groups,
      ...additions.groups.filter((group) => !existingGroupIds.has(group.id)),
    ],
    projects: [...manifest.projects, ...additions.projects],
  };

  await writeManifest(vaultRoot, merged);

  const { plan, files } = generateFiles(merged);
  const results = await writeFiles(vaultRoot, files, { repair: true });
  const created = results
    .filter((entry) => entry.action === "created" || entry.action === "updated")
    .map((entry) => entry.path);

  const patched: string[] = [];
  const newIds = new Set(additions.projects.map((project) => project.id));

  // Recall Map: append a route for each new project.
  const recallPath = resolve(vaultRoot, plan.recallMap.path);
  if (existsSync(recallPath)) {
    let content = await readFile(recallPath, "utf8");
    let changed = false;

    for (const projectPlan of plan.allProjects) {
      if (!newIds.has(projectPlan.project.id)) continue;
      if (content.includes(`### ${projectPlan.project.name}\n`)) continue;
      const section = recallRouteSection(plan, projectPlan);
      const result = insertSectionBefore(content, "## Deep Recall Conditions", section);
      content = result.content;
      changed = changed || result.changed;
    }

    if (changed) {
      await writeFile(recallPath, content, "utf8");
      patched.push(plan.recallMap.path);
    }
  }

  // Parent hubs: link down to the new sub-project.
  for (const projectPlan of plan.allProjects) {
    if (!newIds.has(projectPlan.project.id)) continue;
    if (!projectPlan.project.parent) continue;

    const parentPlan = plan.allProjects.find(
      (candidate) => candidate.project.id === projectPlan.project.parent,
    );
    if (!parentPlan) continue;

    const parentPath = resolve(vaultRoot, parentPlan.hub.path);
    if (!existsSync(parentPath)) continue;

    const current = await readFile(parentPath, "utf8");
    const result = ensureBulletUnderHeading(
      current,
      "## Sub-Projects",
      `- [[${projectPlan.hub.name}]]`,
    );
    if (result.changed) {
      await writeFile(parentPath, result.content, "utf8");
      patched.push(parentPlan.hub.path);
    }
  }

  const report = await runDoctor(vaultRoot, merged);
  if (!report.ok) reportDoctor(report);

  return { created, patched, ok: report.ok };
}

export type DetailMode = "skip" | "manual" | "ai";

/**
 * How the project notes get their content. Manual stays the default so pressing
 * enter reproduces the flow operators already know.
 */
export async function askDetailMode(locale: Locale): Promise<DetailMode> {
  const t = messages(locale);
  return askSelect<DetailMode>({
    message: t.detailModeQuestion,
    options: [
      { value: "manual", label: t.detailModeManual, hint: t.detailModeManualHint },
      { value: "ai", label: t.detailModeAi, hint: t.detailModeAiHint },
      { value: "skip", label: t.detailModeSkip, hint: t.detailModeSkipHint },
    ],
    initialValue: "manual",
  });
}

function seedProject(id: string, name: string): ProjectNode {
  return {
    id,
    name,
    parent: null,
    group: null,
    status: "active",
    summary: "",
    triggers: [name],
    specialized: [],
  };
}

/**
 * Ask the per-project questions for a list of names. Shared by `init`, `add`,
 * and `import`.
 *
 * The AI path answers these questions too, because they are the ones an AI
 * cannot answer for us: hierarchy, grouping and the specialized note list decide
 * the directory layout and the generated system notes, and they are settled
 * before a single file is written — while the AI session only starts once the
 * notes exist. A project described entirely after generation would sit outside
 * the graph. What the AI takes over is the note bodies, which is where the work
 * actually is. Only `skip` leaves an untouched seed node.
 */
export async function collectProjectDetails(
  names: string[],
  manifest: Pick<VaultManifest, "projects" | "groups">,
  locale: Locale,
  mode: DetailMode = "manual",
): Promise<{ projects: ProjectNode[]; groups: ProjectGroup[] }> {
  setPromptLocale(locale);
  const t = messages(locale);
  const takenIds = new Set(manifest.projects.map((project) => project.id));
  const groups: ProjectGroup[] = [];
  const projects: ProjectNode[] = [];
  const selectable = [...manifest.projects];

  if (mode === "ai" && names.length > 0) p.log.info(t.aiStructureNote);

  for (const name of names) {
    const id = makeProjectId(name, takenIds);

    if (mode === "skip") {
      projects.push(seedProject(id, name));
      continue;
    }

    p.log.step(t.projectSection(name));

    const summary = (
      await askText({
        message: t.summaryQuestion(name),
        placeholder: mode === "ai" ? t.summaryAiHint : undefined,
      })
    ).trim();

    const parent =
      selectable.length === 0
        ? null
        : (await askSelect({
            message: t.parentQuestion(name),
            options: [
              { value: "", label: t.parentNone },
              ...selectable.map((project) => ({ value: project.id, label: project.name })),
            ],
            initialValue: "",
          })) || null;

    let group: string | null = null;
    if (!parent) {
      const available = [...manifest.groups, ...groups];
      const choice = await askSelect({
        message: t.groupQuestion(name),
        options: [
          { value: "", label: t.groupNone },
          ...available.map((entry) => ({ value: entry.id, label: entry.name })),
          { value: "__new__", label: t.groupNew },
        ],
        initialValue: "",
      });

      if (choice === "__new__") {
        const groupName = (await askText({ message: t.groupNameQuestion, required: true })).trim();
        const groupId = slugify(groupName) || `group-${available.length + 1}`;
        groups.push({ id: groupId, name: groupName, navigationOnly: true });
        group = groupId;
      } else {
        group = choice || null;
      }
    }

    const specialized = await askMultiselect({
      message: t.specializedQuestion(name),
      options: KNOWN_SPECIALIZED_NOTES.map((kind) => ({ value: kind, label: kind })),
    });

    const triggers = splitList(
      await askText({
        message: t.triggersQuestion(name),
        placeholder: t.triggersHint,
        defaultValue: name,
        initialValue: name,
      }),
    );

    const project: ProjectNode = {
      id,
      name,
      parent,
      group,
      status: "active",
      summary,
      triggers: triggers.length ? triggers : [name],
      specialized: [...specialized],
    };
    projects.push(project);
    selectable.push(project);
  }

  return { projects, groups };
}

export interface AddOptions {
  cwd?: string;
  names?: string[];
  /** `true` picks the AI path, a string also names the CLI to hand over to. */
  ai?: string | boolean;
}

export async function addProjectCommand(options: AddOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    process.stderr.write("No vulcanus.json found. Run `vulcanus init` first.\n");
    return 2;
  }

  const manifest = await readManifest(vaultRoot);
  const locale: Locale = manifest.vault.language === "tr" ? "tr" : "en";
  const t = messages(locale);

  p.intro(`add project — ${manifest.vault.name}`);

  const names =
    options.names && options.names.length > 0
      ? options.names
      : splitList(await askText({ message: t.manualProjectsQuestion, required: true }));

  const requested: DetailMode = options.ai ? "ai" : await askDetailMode(locale);

  // Planned before anything is written, so a machine without an AI CLI falls
  // back to the questions instead of creating projects nobody described.
  const handoff =
    requested === "ai"
      ? await planHandoff(names, locale, typeof options.ai === "string" ? options.ai : undefined)
      : null;
  const mode: DetailMode = requested === "ai" && !handoff ? "manual" : requested;

  const { projects, groups } = await collectProjectDetails(names, manifest, locale, mode);

  const spinner = p.spinner();
  spinner.start(t.generating);
  const result = await applyProjects(vaultRoot, manifest, { projects, groups });
  spinner.stop(`${result.created.length} files written, ${result.patched.length} patched`);

  // Surface what the plan actually produced so the operator can review it.
  const merged = await readManifest(vaultRoot);
  const plan = buildPlan(merged);
  p.note(
    projects
      .map((project) => {
        const planned = plan.allProjects.find((entry) => entry.project.id === project.id);
        return planned ? `${project.name} → ${planned.dir}` : project.name;
      })
      .join("\n"),
    "Added",
  );

  const afterAi = handoff ? await runHandoff(vaultRoot, merged, handoff, locale) : null;
  const ok = afterAi ? afterAi.ok : result.ok;

  p.outro(ok ? "PASS" : "FAIL — see findings above");
  return ok ? 0 : 1;
}
