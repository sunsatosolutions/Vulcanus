import type { VaultPlan } from "../manifest/derive.js";
import { mergeProtocol } from "./merge.js";
import { PROTOCOL_VERSION } from "../version.js";
import { bulletList, joinSections } from "../util/text.js";
import { renderTree } from "../util/tree.js";
import type { GeneratedFile } from "./types.js";

function mdLink(note: { name: string; path: string }): string {
  return `[\`${note.name}\`](${encodeURI(note.path)})`;
}

function agentsFile(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;
  const { admin, vault, structure } = manifest;

  const content = joinSections([
    `# ${vault.name} Protocol for AI Agents`,
    `<!-- vulcanus:protocol ${PROTOCOL_VERSION} -->`,
    `This repository is ${vault.name}${
      vault.fullName ? ` (${vault.fullName})` : ""
    }, a living, AI-readable second brain. These instructions apply to every task in this repository.`,
    [
      "## Required workflow",
      "",
      [
        `Before working, read ${mdLink(plan.index)}, ${mdLink(plan.recallMap)}, and the relevant project Capsule. Expand into the Hub, Context, Decisions, Rules, or specialized memory only when needed.`,
        `Treat ${vault.name} as the source of truth. Prefer the latest explicit correction from ${admin.name} and the most specific project file when information conflicts.`,
        `When interpreting ${admin.name}'s preferences, project ownership, communication style, or admin-level corrections, read ${mdLink(plan.adminProfile)}.`,
        "Complete the requested work without inventing missing project facts.",
        "At the end of the task, determine whether durable memory changed.",
        "If durable memory changed, update the relevant Markdown files: Context for identity and scope, Decisions for confirmed choices and corrections, Rules for future behavior, and specialized files for domain memory.",
        "Put uncertain or unconfirmed information under `Needs Confirmation`; do not record it as fact.",
        "After changes, run `vulcanus doctor` and require it to pass.",
        'Then run `vulcanus sync "short topic"` to commit and push when `origin` is configured.',
        "Report whether memory changed, the files changed, the validation result, commit hash, push status, and any `Needs Confirmation` items.",
      ]
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n"),
      "",
      `If no durable memory changed, do not edit ${vault.name} merely to create activity. Report \`update not needed\` with a brief reason.`,
    ].join("\n"),
    [
      "## Durable memory boundary",
      "",
      `Update ${vault.name} for durable project definitions, scope, decisions, corrections, constraints, reusable implementation patterns, architecture choices, workflows, visual rules, or knowledge that should change future AI behavior.`,
      "",
      "Do not update it for casual chat, repeated explanations, one-off commands, temporary debugging, unconfirmed guesses, or failed experiments unless they become a reusable rule or confirmed decision.",
    ].join("\n"),
    [
      "## Token-efficient recall protocol",
      "",
      bulletList([
        `Start with ${mdLink(plan.recallMap)} and the relevant Capsule.`,
        "Only read full Context, Decisions, and Rules when the Capsule does not provide enough authority or detail.",
        "Use deep recall for architecture, scope, rules, visual identity, legal or content constraints, algorithms, safety behavior, or durable memory changes.",
        "Read specialized files only when their domain is directly relevant.",
        "If the minimum layer resolves a low-risk task, do not load the entire project cluster.",
        "When uncertain or when sources conflict, move to the next layer and prefer the latest explicit correction and the most specific file.",
      ]),
    ].join("\n"),
    [
      "## Recursive consolidation",
      "",
      "After work, check whether durable knowledge requires updates to the Capsule, Recall Map, Context, Decisions, Rules, or a specialized file. Also check whether older information should be deprecated and whether unresolved items belong under `Needs Confirmation`.",
      "",
      `Major protocol or structure changes must also update ${mdLink(plan.system.get("Changelog")!)}.`,
    ].join("\n"),
    [
      "## Structure",
      "",
      "```txt",
      renderTree(vault.name, [
        "AGENTS.md",
        "README.md",
        "vulcanus.json",
        `${structure.systemDir}/`,
        `${structure.projectsDir}/`,
        `${structure.importsDir}/`,
      ]),
      "```",
      "",
      bulletList([
        `\`${structure.systemDir}/\` — routing, protocol, operator profile, and memory-format notes.`,
        `\`${structure.projectsDir}/\` — one cluster per project: Capsule, Hub, Context, Decisions, Rules, plus specialized notes.`,
        `\`${structure.importsDir}/\` — raw AI exports. Ignored by Git and treated as untrusted source material.`,
        "`vulcanus.json` — the manifest the structure and its validation are derived from.",
      ]),
    ].join("\n"),
    [
      "## Safety",
      "",
      bulletList([
        `Follow ${mdLink(plan.system.get("Rules")!)} and ${mdLink(plan.system.get("Update Format")!)}; this file supplements them and does not override them.`,
        `Never commit raw AI exports or anything under \`${structure.importsDir}/\`.`,
        `Never commit generated state under \`${structure.stateDir}/\`.`,
        "Preserve ignored local and sensitive files.",
        "Keep Markdown and Obsidian wiki links valid.",
        "Do not add new projects or project relationships without explicit confirmation.",
        "Do not claim a commit or push succeeded unless it actually did.",
      ]),
    ].join("\n"),
  ]);

  // The protocol has to reach existing vaults, and operators extend it with
  // their own steps. Merging is what makes both true; see generate/merge.ts.
  return { path: "AGENTS.md", content, kind: "merge", merge: mergeProtocol };
}

function readmeFile(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;
  const { vault, admin, structure } = manifest;

  const content = joinSections([
    `# ${vault.name}${vault.fullName ? ` — ${vault.fullName}` : ""}`,
    vault.tagline ??
      `${vault.name} is an AI-readable second brain: durable project context, decisions, rules, and constraints in linked Markdown, so humans and AI agents can resume work with reliable context.`,
    [
      "## Core Model",
      "",
      bulletList([
        "Notes are memory nodes.",
        "Hubs are neural clusters.",
        "Wikilinks are recall paths.",
        "Capsules are token-efficient recall entry points.",
        "Git is versioned memory history.",
      ]),
    ].join("\n"),
    [
      "## Vault Structure",
      "",
      "```txt",
      renderTree(vault.name, [
        "AGENTS.md",
        "README.md",
        "vulcanus.json",
        `${structure.systemDir}/`,
        `${structure.projectsDir}/`,
        `${structure.importsDir}/  # ignored raw source material`,
      ]),
      "```",
    ].join("\n"),
    [
      "## Recall Workflow",
      "",
      "AI agents should read the smallest reliable memory layer, in this order:",
      "",
      [
        "[`AGENTS.md`](AGENTS.md)",
        mdLink(plan.recallMap),
        "The relevant project Capsule",
        "The relevant Hub",
        "Context, Decisions, and Rules when needed",
        "Specialized files only when the task requires them",
      ]
        .map((entry, index) => `${index + 1}. ${entry}`)
        .join("\n"),
      "",
      `${vault.name} is the source of truth. Prefer ${admin.name}'s latest explicit correction and the most specific project file when sources conflict.`,
    ].join("\n"),
    [
      "## Maintenance",
      "",
      "```bash",
      "vulcanus doctor",
      "```",
      "",
      "```bash",
      'vulcanus sync "short topic"',
      "```",
      "",
      `\`doctor\` validates frontmatter, wikilinks, hub coverage, return links, and Capsule/Recall-Map coverage against \`vulcanus.json\`. \`sync\` runs the same validation, then commits and pushes.`,
    ].join("\n"),
    [
      "## Adding Memory",
      "",
      bulletList([
        `Add a project: \`vulcanus add project\` — writes the cluster and updates the Index, Recall Map, and hubs.`,
        `Import from an AI export: \`vulcanus import\` — extracts project candidates without copying raw conversations.`,
        `Follow ${mdLink(plan.system.get("Update Format")!)} when converting a conversation into durable memory.`,
      ]),
    ].join("\n"),
    [
      "## Safety",
      "",
      bulletList([
        "Never commit raw AI exports.",
        "Do not invent project information.",
        "Put uncertain information under `Needs Confirmation`.",
        "Do not add new projects without explicit confirmation.",
        "Keep Markdown valid, concise, and Obsidian-friendly.",
      ]),
    ].join("\n"),
    `_Generated by [Vulcanus](https://github.com/) — vault structure is defined in \`vulcanus.json\`._`,
  ]);

  return { path: "README.md", content, kind: "seed" };
}

function gitignoreFile(plan: VaultPlan): GeneratedFile {
  const { structure } = plan.manifest;
  const content = [
    "# Raw AI exports are untrusted source material and must never be committed.",
    `${structure.importsDir}/*`,
    `!${structure.importsDir}/README.md`,
    "",
    "# Generated, disposable vault state.",
    `${structure.stateDir}/`,
    "",
    "# OS and editor noise",
    ".DS_Store",
    "Thumbs.db",
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
    "",
  ].join("\n");

  return { path: ".gitignore", content, kind: "seed" };
}

function importsReadme(plan: VaultPlan): GeneratedFile {
  const { structure, vault } = plan.manifest;
  const content = joinSections([
    "# Imports",
    `Raw AI conversation exports live here. This directory is ignored by Git on purpose.`,
    [
      "## Rules",
      "",
      bulletList([
        "Treat everything in here as untrusted source material.",
        `Extract only confirmed, durable memory into ${vault.name} notes.`,
        "Never commit raw exports, and never copy raw conversation text into durable memory.",
        "Record what was extracted in the Import Log instead.",
      ]),
    ].join("\n"),
    [
      "## Usage",
      "",
      "```bash",
      `vulcanus import --source chatgpt --path ${structure.importsDir}/chatgpt-export`,
      "```",
    ].join("\n"),
  ]);

  return { path: `${structure.importsDir}/README.md`, content, kind: "seed" };
}

/**
 * Seed Obsidian so the folder opens as a usable vault immediately: shortest
 * wikilinks (matching what the generator writes) and links that follow renames.
 */
function obsidianConfig(): GeneratedFile {
  const settings = {
    alwaysUpdateLinks: true,
    newLinkFormat: "shortest",
    useMarkdownLinks: false,
    showUnsupportedFiles: false,
    strictLineBreaks: false,
  };

  return {
    path: ".obsidian/app.json",
    content: `${JSON.stringify(settings, null, 2)}\n`,
    kind: "seed",
  };
}

export function generateRootFiles(plan: VaultPlan): GeneratedFile[] {
  return [
    agentsFile(plan),
    readmeFile(plan),
    gitignoreFile(plan),
    importsReadme(plan),
    obsidianConfig(),
  ];
}
