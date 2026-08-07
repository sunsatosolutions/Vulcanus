import type { GroupPlan, ProjectPlan, VaultPlan } from "../manifest/derive.js";
import { renderFrontmatter } from "../util/markdown.js";
import { bulletList, joinSections, slugify } from "../util/text.js";
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
      "## Identity",
      "",
      summary || `_${name} has no confirmed summary yet._`,
      parentName ? `\n${name} belongs under ${parentName}.` : "",
    ].join("\n"),
    [
      "## Current Scope",
      "",
      "Durable memory currently covers the definition recorded at vault creation. Expand it only with confirmed information.",
    ].join("\n"),
    [
      "## Must Remember",
      "",
      bulletList(
        [
          summary ? summary : "",
          parentName ? `${parentName} is ${name}'s parent.` : `${name} is a top-level project.`,
          `Keep ${name} memory limited to ${name}-specific confirmed facts.`,
          "Mark unresolved scope and relationships as `Needs Confirmation`.",
        ].filter(Boolean),
      ),
    ].join("\n"),
    [
      "## Do Not Assume",
      "",
      bulletList([
        `Do not invent ${name}'s ownership, legal structure, or operational relationships.`,
        "Do not infer relationships from graph navigation.",
      ]),
    ].join("\n"),
    [
      "## Read Next",
      "",
      bulletList([
        wiki(project.hub.name),
        wiki(project.context.name),
        wiki(project.decisions.name),
        wiki(project.rules.name),
        ...project.specialized.map((entry) => wiki(entry.note.name)),
      ]),
    ].join("\n"),
    ["## Needs Confirmation", "", `- Detailed scope and operating structure for ${name}.`].join(
      "\n",
    ),
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
    ["## Purpose", "", `${project.hub.name} is the memory and navigation point for ${name}.`].join(
      "\n",
    ),
    [
      "## Scope",
      "",
      `Use this hub for confirmed ${name} context, decisions, rules, and scope definition without importing assumptions from other projects.`,
    ].join("\n"),
    ["## Core Files", "", bulletList(coreFiles)].join("\n"),
    ["## Parent", "", bulletList([wiki(project.parentLink.name)])].join("\n"),
    project.children.length
      ? [
          "## Sub-Projects",
          "",
          bulletList(project.children.map((child) => wiki(child.hub.name))),
        ].join("\n")
      : "",
    [
      "## Core Memory",
      "",
      bulletList(
        [project.project.summary, `${name} keeps its own Context, Decisions, and Rules.`].filter(
          Boolean,
        ),
      ),
    ].join("\n"),
    [
      "## Active Rules",
      "",
      bulletList([
        "Do not infer products, ownership, legal structure, or unconfirmed operations.",
        `Keep ${name}'s memory distinct from neighbouring projects.`,
        "Mark unresolved scope as `Needs Confirmation`.",
      ]),
    ].join("\n"),
    [
      "## Next Actions",
      "",
      bulletList([
        `Record confirmed ${name} definitions in ${wiki(project.context.name)}.`,
        `Record confirmed choices in ${wiki(project.decisions.name)}.`,
        `Record future behavior constraints in ${wiki(project.rules.name)}.`,
      ]),
    ].join("\n"),
    ["## Needs Confirmation", "", `- Detailed operating model for ${name}.`].join("\n"),
  ]);

  return { path: project.hub.path, content, kind: "seed" };
}

function navigation(project: ProjectPlan, exclude: string): string {
  const entries: string[] = [`Hub: ${wiki(project.hub.name)}`];
  if (exclude !== "context") entries.push(`Context: ${wiki(project.context.name)}`);
  if (exclude !== "decisions") entries.push(`Decisions: ${wiki(project.decisions.name)}`);
  if (exclude !== "rules") entries.push(`Rules: ${wiki(project.rules.name)}`);
  return ["## Navigation", "", bulletList(entries)].join("\n");
}

function contextNote(plan: VaultPlan, project: ProjectPlan): GeneratedFile {
  const { name, status, summary } = project.project;
  const parentName = project.ancestors.at(-1)?.name;

  const content = joinSections([
    projectFrontmatter(plan, project, "context"),
    `# ${project.context.name}`,
    navigation(project, "context"),
    ["## Project Name", "", name].join("\n"),
    ["## Status", "", status].join("\n"),
    [
      "## Core Definition",
      "",
      summary || `_${name}'s definition has not been recorded yet._`,
      parentName ? `\n${name} operates under ${parentName}.` : "",
    ].join("\n"),
    [
      `## What ${name} Is`,
      "",
      bulletList([summary || `a project tracked in ${plan.manifest.vault.name}`]),
    ].join("\n"),
    [
      `## What ${name} Is Not`,
      "",
      bulletList([
        "a parent or umbrella for unrelated projects",
        "a placeholder for work that belongs to another project",
      ]),
    ].join("\n"),
    [
      "## Current Scope",
      "",
      `Only the definition above is confirmed. Everything else about ${name} must be added explicitly.`,
    ].join("\n"),
    [
      "## Needs Confirmation",
      "",
      bulletList([
        `${name}'s detailed scope, deliverables, and operating model.`,
        `${name}'s relationships to other projects beyond what is recorded here.`,
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
        `## ${parentName} Parent Relationship`,
        "",
        "### Decision",
        "",
        `${name} operates under ${parentName}.`,
        "",
        "### Details",
        "",
        `${name} keeps its own Context, Decisions, and Rules inside the ${parentName} hierarchy.`,
        "",
        "### Impact",
        "",
        "```txt",
        `${parentName}`,
        `└─ ${name}`,
        "```",
      ].join("\n")
    : [
        `## ${name} Is a Top-Level Project`,
        "",
        "### Decision",
        "",
        `${name} is tracked as its own top-level project.`,
        "",
        "### Details",
        "",
        `${name} is not owned by, and does not own, another project unless that is explicitly recorded.`,
        "",
        "### Impact",
        "",
        "Do not place other projects under it by inference.",
      ].join("\n");

  const content = joinSections([
    projectFrontmatter(plan, project, "decisions"),
    `# ${project.decisions.name}`,
    navigation(project, "decisions"),
    parentDecision,
    "---",
    [
      "## Scope Definition",
      "",
      "### Decision",
      "",
      `${name}'s durable memory starts from its recorded definition only.`,
      "",
      "### Details",
      "",
      "No visual direction, business model, product list, or hierarchy is confirmed yet.",
      "",
      "### Impact",
      "",
      `Do not invent ${name} details; wait for explicit confirmation.`,
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
      "## Boundary Rule",
      "",
      parentName
        ? `${name} belongs under ${parentName}. Keep its own identity and memory cluster, but do not describe it as independent from ${parentName}.`
        : `${name} is a top-level project. Do not place it under another project, and do not treat it as an umbrella for others.`,
    ].join("\n"),
    [
      "## Scope Caution Rule",
      "",
      `When discussing ${name}, avoid inventing:`,
      "",
      bulletList([
        "product list",
        "brand hierarchy",
        "business model",
        "sub-projects",
        "unconfirmed ownership relationships",
      ]),
      "",
      `Wait for ${plan.manifest.admin.name}'s confirmation before adding structure.`,
    ].join("\n"),
    [
      "## Memory Organization Rule",
      "",
      `Keep ${name}-specific facts inside this cluster. Do not store unrelated project details here.`,
    ].join("\n"),
    [
      "## Assistant Response Rule",
      "",
      bulletList([
        `Read ${wiki(project.capsule.name)} first, then expand only as needed.`,
        `Do not invent ${name} details without confirmation.`,
        `Keep the answer clean and cautious when ${name} context is incomplete.`,
        `When new ${name} details arrive, update ${wiki(project.context.name)} before expanding decisions or rules.`,
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
    Architecture: `Implementation layers, runtime boundaries, data flow, persistence, and deployment decisions for ${project.project.name}.`,
    Flow: `End-to-end user and system flow for ${project.project.name}, including states, transitions, and failure paths.`,
    "Visual Direction": `Approved visual identity for ${project.project.name}: logo usage, palette, typography, imagery, and application rules.`,
    "Content Guidelines": `Voice, tone, copy patterns, and content constraints for ${project.project.name}.`,
  };

  const content = joinSections([
    projectFrontmatter(plan, project, slugify(kind)),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([`Hub: ${wiki(project.hub.name)}`, `Context: ${wiki(project.context.name)}`]),
    ].join("\n"),
    [
      "## Purpose",
      "",
      purpose[kind] ?? `Domain-specific memory for ${project.project.name}: ${kind}.`,
    ].join("\n"),
    ["## Confirmed", "", "_Nothing confirmed yet._"].join("\n"),
    [
      "## Needs Confirmation",
      "",
      `- Everything in this note until ${plan.manifest.admin.name} records a confirmed decision.`,
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
      "## Purpose",
      "",
      group.group.summary || `Navigation cluster for ${group.group.name} projects.`,
    ].join("\n"),
    group.group.navigationOnly
      ? [
          "## Boundary",
          "",
          "This grouping exists for graph navigation only. It does not imply ownership, a shared business hierarchy, or any relationship between the projects below.",
        ].join("\n")
      : "",
    ["## Projects", "", bulletList(group.members.map((member) => wiki(member.hub.name)))].join(
      "\n",
    ),
    ["## Parent", "", bulletList([wiki(plan.index.name)])].join("\n"),
  ]);

  // Seed, like project hubs: `add project` links new members in surgically.
  return { path: group.hub.path, content, kind: "seed" };
}

export function generateProjectNotes(plan: VaultPlan): GeneratedFile[] {
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
