import type { GroupPlan, ProjectPlan, VaultPlan } from "../manifest/derive.js";
import { renderFrontmatter } from "../util/markdown.js";
import { bulletList, joinSections, slugify } from "../util/text.js";
import { noteText, type NoteText } from "./text.js";

/**
 * The catalog for the language this vault is written in.
 *
 * Module-scoped rather than threaded through every helper: generation is one
 * synchronous pass from a single entry point, and the alternative is an extra
 * parameter on a dozen functions that would only ever carry the same value.
 * The entry point below sets it before anything is generated.
 */
let t: NoteText = noteText("en");
import type { GeneratedFile } from "./types.js";

function wiki(name: string): string {
  return `[[${name}]]`;
}

function projectFrontmatter(plan: VaultPlan, project: ProjectPlan, type: string): string {
  const parentName = project.ancestors.at(-1)?.name;
  return renderFrontmatter({
    type,
    project: project.project.name,
    ...(parentName ? { parent: parentName } : {}),
    status: project.project.status,
    tags: [slugify(plan.manifest.vault.name), type, slugify(project.project.name), "project"],
  });
}

function capsuleNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name, summary } = project.project;
  const parentName = project.ancestors.at(-1)?.name;

  const content = joinSections([
    projectFrontmatter(plan, project, "capsule"),
    `# ${project.capsule.name}`,
    [
      t.heading("Identity"),
      "",
      summary || t("project.capsuleNote.1", { name: name }),
      parentName ? t("project.capsuleNote.2", { name: name, parentName: parentName }) : "",
    ].join("\n"),
    [t.heading("Current Scope"), "", t("project.capsuleNote.3")].join("\n"),
    [
      t.heading("Must Remember"),
      "",
      bulletList(
        [
          summary ? summary : "",
          parentName
            ? t("project.capsuleNote.4", { parentName: parentName, name: name })
            : t("project.capsuleNote.5", { name: name }),
          t("project.capsuleNote.6", { name: name }),
          t("project.capsuleNote.7"),
        ].filter(Boolean),
      ),
    ].join("\n"),
    [
      t.heading("Do Not Assume"),
      "",
      bulletList([t("project.capsuleNote.8", { name: name }), t("project.capsuleNote.9")]),
    ].join("\n"),
    [
      t.heading("Read Next"),
      "",
      bulletList([
        wiki(project.hub.name),
        wiki(project.context.name),
        wiki(project.decisions.name),
        wiki(project.rules.name),
        ...project.specialized.map((entry) => wiki(entry.note.name)),
      ]),
    ].join("\n"),
    [t.heading("Needs Confirmation"), "", t("project.capsuleNote.10", { name: name })].join("\n"),
  ]);

  return { path: project.capsule.path, content, kind: "seed" };
}

function hubNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name } = project.project;

  const coreFiles = [
    wiki(project.capsule.name),
    wiki(project.context.name),
    wiki(project.decisions.name),
    wiki(project.rules.name),
    ...project.specialized.map((entry) => wiki(entry.note.name)),
  ];

  const content = joinSections([
    projectFrontmatter(plan, project, "hub"),
    `# ${project.hub.name}`,
    [
      t.heading("Purpose"),
      "",
      t("project.hubNote.1", { name: project.hub.name, name2: name }),
    ].join("\n"),
    [t.heading("Scope"), "", t("project.hubNote.2", { name: name })].join("\n"),
    [t.heading("Core Files"), "", bulletList(coreFiles)].join("\n"),
    [t.heading("Parent"), "", bulletList([wiki(project.parentLink.name)])].join("\n"),
    project.children.length
      ? [
          t.heading("Sub-Projects"),
          "",
          bulletList(project.children.map((child) => wiki(child.hub.name))),
        ].join("\n")
      : "",
    [
      t.heading("Core Memory"),
      "",
      bulletList([project.project.summary, t("project.hubNote.3", { name: name })].filter(Boolean)),
    ].join("\n"),
    [
      t.heading("Active Rules"),
      "",
      bulletList([
        t("project.hubNote.4"),
        t("project.hubNote.5", { name: name }),
        t("project.hubNote.6"),
      ]),
    ].join("\n"),
    [
      t.heading("Next Actions"),
      "",
      bulletList([
        t("project.hubNote.7", { name: name, name2: wiki(project.context.name) }),
        t("project.hubNote.8", { name: wiki(project.decisions.name) }),
        t("project.hubNote.9", { name: wiki(project.rules.name) }),
      ]),
    ].join("\n"),
    [t.heading("Needs Confirmation"), "", t("project.hubNote.10", { name: name })].join("\n"),
  ]);

  return { path: project.hub.path, content, kind: "seed" };
}

function navigation(project: ProjectPlan, exclude: string): string {
  const entries: string[] = [`Hub: ${wiki(project.hub.name)}`];
  if (exclude !== "context") entries.push(`Context: ${wiki(project.context.name)}`);
  if (exclude !== "decisions")
    entries.push(t("project.navigation.1", { name: wiki(project.decisions.name) }));
  if (exclude !== "rules") entries.push(`Rules: ${wiki(project.rules.name)}`);
  return [t.heading("Navigation"), "", bulletList(entries)].join("\n");
}

function contextNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name, status, summary } = project.project;
  const parentName = project.ancestors.at(-1)?.name;

  const content = joinSections([
    projectFrontmatter(plan, project, "context"),
    `# ${project.context.name}`,
    navigation(project, "context"),
    [t.heading("Project Name"), "", name].join("\n"),
    [t.heading("Status"), "", status].join("\n"),
    [
      t.heading("Core Definition"),
      "",
      summary || t("project.contextNote.1", { name: name }),
      parentName ? t("project.contextNote.2", { name: name, parentName: parentName }) : "",
    ].join("\n"),
    [
      t("project.contextNote.3", { name: name }),
      "",
      bulletList([summary || t("project.contextNote.4", { name: plan.manifest.vault.name })]),
    ].join("\n"),
    [
      t("project.contextNote.5", { name: name }),
      "",
      bulletList([t("project.contextNote.6"), t("project.contextNote.7")]),
    ].join("\n"),
    [t.heading("Current Scope"), "", t("project.contextNote.8", { name: name })].join("\n"),
    [
      t.heading("Needs Confirmation"),
      "",
      bulletList([
        t("project.contextNote.9", { name: name }),
        t("project.contextNote.10", { name: name }),
      ]),
    ].join("\n"),
  ]);

  return { path: project.context.path, content, kind: "seed" };
}

function decisionsNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name } = project.project;
  const parentName = project.ancestors.at(-1)?.name;

  const parentDecision = parentName
    ? [
        t("project.decisionsNote.1", { parentName: parentName }),
        "",
        t("project.decisionsNote.2"),
        "",
        t("project.decisionsNote.3", { name: name, parentName: parentName }),
        "",
        "### Details",
        "",
        t("project.decisionsNote.4", { name: name, parentName: parentName }),
        "",
        "### Impact",
        "",
        "```txt",
        `${parentName}`,
        `└─ ${name}`,
        "```",
      ].join("\n")
    : [
        t("project.decisionsNote.5", { name: name }),
        "",
        t("project.decisionsNote.6"),
        "",
        t("project.decisionsNote.7", { name: name }),
        "",
        "### Details",
        "",
        t("project.decisionsNote.8", { name: name }),
        "",
        "### Impact",
        "",
        t("project.decisionsNote.9"),
      ].join("\n");

  const content = joinSections([
    projectFrontmatter(plan, project, "decisions"),
    `# ${project.decisions.name}`,
    navigation(project, "decisions"),
    parentDecision,
    "---",
    [
      t.heading("Scope Definition"),
      "",
      t("project.decisionsNote.10"),
      "",
      t("project.decisionsNote.11", { name: name }),
      "",
      "### Details",
      "",
      t("project.decisionsNote.12"),
      "",
      "### Impact",
      "",
      t("project.decisionsNote.13", { name: name }),
    ].join("\n"),
  ]);

  return { path: project.decisions.path, content, kind: "seed" };
}

function rulesNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name } = project.project;
  const parentName = project.ancestors.at(-1)?.name;

  const content = joinSections([
    projectFrontmatter(plan, project, "rules"),
    `# ${project.rules.name}`,
    navigation(project, "rules"),
    [
      t.heading("Boundary Rule"),
      "",
      parentName
        ? t("project.rulesNote.1", { name: name, parentName: parentName })
        : t("project.rulesNote.2", { name: name }),
    ].join("\n"),
    [
      t.heading("Scope Caution Rule"),
      "",
      t("project.rulesNote.3", { name: name }),
      "",
      bulletList([
        t("project.rulesNote.4"),
        t("project.rulesNote.5"),
        t("project.rulesNote.6"),
        "sub-projects",
        t("project.rulesNote.7"),
      ]),
      "",
      t("project.rulesNote.8", { name: plan.manifest.admin.name }),
    ].join("\n"),
    [t.heading("Memory Organization Rule"), "", t("project.rulesNote.9", { name: name })].join(
      "\n",
    ),
    [
      t.heading("Assistant Response Rule"),
      "",
      bulletList([
        t("project.rulesNote.10", { name: wiki(project.capsule.name) }),
        t("project.rulesNote.11", { name: name }),
        t("project.rulesNote.12", { name: name }),
        t("project.rulesNote.13", { name: name, name2: wiki(project.context.name) }),
      ]),
    ].join("\n"),
  ]);

  return { path: project.rules.path, content, kind: "seed" };
}

function specializedNote(
  plan: VaultPlan,
  project: ProjectPlan,
  kind: string,
  note: { name: string; path: string },
): GeneratedFile {
  const purpose: Record<string, string> = {
    Architecture: t("project.specializedNote.1", { name: project.project.name }),
    Flow: t("project.specializedNote.2", { name: project.project.name }),
    "Visual Direction": t("project.specializedNote.3", { name: project.project.name }),
    "Content Guidelines": t("project.specializedNote.4", { name: project.project.name }),
  };

  const content = joinSections([
    projectFrontmatter(plan, project, slugify(kind)),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([`Hub: ${wiki(project.hub.name)}`, `Context: ${wiki(project.context.name)}`]),
    ].join("\n"),
    [
      t.heading("Purpose"),
      "",
      purpose[kind] ?? t("project.specializedNote.5", { name: project.project.name, kind: kind }),
    ].join("\n"),
    [t.heading("Confirmed"), "", t("project.specializedNote.6")].join("\n"),
    [
      t.heading("Needs Confirmation"),
      "",
      t("project.specializedNote.7", { name: plan.manifest.admin.name }),
    ].join("\n"),
  ]);

  return { path: note.path, content, kind: "seed" };
}

function groupHubNote(plan: VaultPlan, group: GroupPlan): GeneratedFile {
  const content = joinSections([
    renderFrontmatter({
      type: "hub",
      project: group.group.name,
      status: "active",
      tags: [slugify(plan.manifest.vault.name), "hub", slugify(group.group.name), "navigation"],
    }),
    `# ${group.hub.name}`,
    [
      t.heading("Purpose"),
      "",
      group.group.summary || t("project.groupHubNote.1", { name: group.group.name }),
    ].join("\n"),
    group.group.navigationOnly
      ? [t.heading("Boundary"), "", t("project.groupHubNote.2")].join("\n")
      : "",
    [
      t.heading("Projects"),
      "",
      bulletList(group.members.map((member) => wiki(member.hub.name))),
    ].join("\n"),
    [t.heading("Parent"), "", bulletList([wiki(plan.index.name)])].join("\n"),
  ]);

  // Seed, like project hubs: `add project` links new members in surgically.
  return { path: group.hub.path, content, kind: "seed" };
}

export function generateProjectNotes(plan: VaultPlan): GeneratedFile[] {
  t = noteText(plan.manifest.vault.language);
  const files: GeneratedFile[] = [];

  for (const group of plan.groups) {
    files.push(groupHubNote(plan, group));
  }

  for (const project of plan.allProjects) {
    files.push(capsuleNote(plan, project));
    files.push(hubNote(plan, project));
    files.push(contextNote(plan, project));
    files.push(decisionsNote(plan, project));
    files.push(rulesNote(plan, project));
    for (const entry of project.specialized) {
      files.push(specializedNote(plan, project, entry.kind, entry.note));
    }
  }

  return files;
}
