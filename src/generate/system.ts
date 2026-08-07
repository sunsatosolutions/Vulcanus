import type { VaultPlan, ProjectPlan } from "../manifest/derive.js";
import { systemNoteKinds } from "../manifest/derive.js";
import { renderFrontmatter } from "../util/markdown.js";
import { bulletList, joinSections, slugify } from "../util/text.js";
import { renderTree } from "../util/tree.js";
import type { GeneratedFile } from "./types.js";

const FRONTMATTER_TYPE: Record<string, string> = {
  Index: "index",
  "Recall Map": "recall-map",
  "Admin Profile": "admin-profile",
  "System Hub": "hub",
  Context: "context",
  Rules: "rules",
  "Update Format": "update-format",
  Changelog: "changelog",
  "Import Log": "import-log",
  "Brain OS Architecture": "architecture",
  "Operating Intuition": "operating-intuition",
  "Neural Link Map": "neural-link-map",
  "Memory Confidence Model": "confidence-model",
};

function frontmatter(plan: VaultPlan, kind: string, extraTags: string[] = []): string {
  const vaultSlug = slugify(plan.manifest.vault.name);
  return renderFrontmatter({
    type: FRONTMATTER_TYPE[kind] ?? "note",
    project: plan.manifest.vault.name,
    status: "active",
    tags: [vaultSlug, "system", ...extraTags],
  });
}

function projectOverview(plan: VaultPlan): string {
  if (plan.allProjects.length === 0) {
    return "_No projects have been defined yet. Add one with `vulcanus add project`._";
  }

  const lines: string[] = [];
  const walk = (project: ProjectPlan, depth: number) => {
    const heading = "#".repeat(Math.min(depth + 3, 6));
    lines.push(`${heading} ${project.project.name}`);
    lines.push("");
    lines.push(project.project.summary || "_Summary not recorded yet._");
    lines.push("");
    for (const child of project.children) walk(child, depth + 1);
  };

  const grouped = new Set<string>();
  for (const group of plan.groups) {
    lines.push(`### ${group.group.name}`);
    lines.push("");
    lines.push(
      group.group.summary ||
        (group.group.navigationOnly
          ? "Graph navigation group. This grouping does not imply ownership or a shared business hierarchy."
          : ""),
    );
    lines.push("");
    for (const member of group.members) {
      grouped.add(member.project.id);
      walk(member, 1);
    }
  }

  for (const root of plan.roots) {
    if (grouped.has(root.project.id)) continue;
    walk(root, 0);
  }

  return lines.join("\n").trim();
}

function indexNote(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;
  const mainHubs = [plan.systemHub.name, plan.recallMap.name];
  if (manifest.vault.profile === "full") {
    mainHubs.push(plan.system.get("Brain OS Architecture")!.name);
    mainHubs.push(plan.system.get("Operating Intuition")!.name);
  }
  for (const group of plan.groups) mainHubs.push(group.hub.name);
  for (const root of plan.roots) {
    if (!root.project.group) mainHubs.push(root.hub.name);
  }

  const treePaths = [
    "AGENTS.md",
    "README.md",
    `${manifest.structure.systemDir}/`,
    ...plan.allNotes.map((note) => note.path),
  ];

  const content = joinSections([
    frontmatter(plan, "Index", ["index", "moc"]),
    `# ${plan.index.name}`,
    manifest.vault.fullName ?? "",
    manifest.vault.tagline ??
      `${manifest.vault.name} is ${manifest.admin.name}'s AI-readable second brain for project context, decisions, rules, and reusable long-term knowledge.`,
    "---",
    [
      "## Operating Principle",
      "",
      `${manifest.vault.name} should be recalled before project work and updated after project work whenever durable knowledge changes.`,
      "",
      `Admin and operator recall is routed through ${wiki(plan.systemHub.name)} to the Admin Profile without expanding this index into a system-file star.`,
    ].join("\n"),
    "---",
    ["## Main Hubs", "", bulletList(mainHubs.map(wiki))].join("\n"),
    "---",
    ["## Active Project Overview", "", projectOverview(plan)].join("\n"),
    "---",
    ["## Current Vault Tree", "", "```txt", renderTree(manifest.vault.name, treePaths), "```"].join(
      "\n",
    ),
    "---",
    [
      "## Global Rules",
      "",
      bulletList([
        `${manifest.vault.name} stores long-term reusable information.`,
        "Do not store random temporary chat.",
        "Do not invent missing details.",
        `Prefer ${manifest.admin.name}'s latest explicit correction.`,
        "Use project-specific files when available.",
        "Keep project boundaries clean.",
        "Do not add new projects without confirmation.",
        "Keep Markdown valid and Obsidian-friendly.",
      ]),
    ].join("\n"),
    "---",
    [
      "## Short Principle",
      "",
      `${manifest.vault.name} turns conversation history into clean, reusable AI memory.`,
    ].join("\n"),
  ]);

  // Seed, not managed: operators write the project overview and their own
  // sections here, and regenerating the file threw that away. New projects are
  // linked in by `add project` instead.
  return { path: plan.index.path, content, kind: "seed" };
}

function wiki(name: string): string {
  return `[[${name}]]`;
}

/** One project's Recall Map route. Also used when appending a route later. */
export function recallRouteSection(plan: VaultPlan, project: ProjectPlan): string {
  const triggers = project.project.triggers.length
    ? project.project.triggers
    : [project.project.name];

  const readOrder = [
    project.capsule.name,
    project.hub.name,
    project.decisions.name,
    project.rules.name,
    project.context.name,
  ];

  const specializedLine = project.specialized.length
    ? `\nThen read ${project.specialized
        .map((entry) => wiki(entry.note.name))
        .join(" and ")} when the task touches that domain.\n`
    : "";

  return [
    `### ${project.project.name}`,
    "",
    "**Trigger Words**",
    "",
    bulletList(triggers),
    "",
    "**Read Order**",
    "",
    readOrder.map((name, index) => `${index + 1}. ${wiki(name)}`).join("\n"),
    specializedLine,
    "**Deep Recall Conditions**",
    "",
    bulletList([
      "scope, identity, or ownership changes",
      "architecture, algorithm, or safety behavior changes",
      "brand, visual, legal, or content constraints change",
      "sources conflict or the Capsule is insufficient",
    ]),
    "",
    "**Update After Work Conditions**",
    "",
    bulletList([
      `${plan.manifest.admin.name} confirms a durable definition, decision, constraint, or future behavior rule`,
      "a reusable implementation pattern emerges",
    ]),
  ].join("\n");
}

function recallMapNote(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;

  const projectRoutes = plan.allProjects.map((project) => recallRouteSection(plan, project));

  const content = joinSections([
    frontmatter(plan, "Recall Map", ["recall", "routing"]),
    `# ${plan.recallMap.name}`,
    [
      "## Purpose",
      "",
      "Route project trigger words to the smallest reliable memory layer and expand recall only when the task requires deeper context.",
    ].join("\n"),
    [
      "## Recall Principles",
      "",
      bulletList([
        "Start with the matching Capsule; use it as a compressed recall entry, not a replacement for source memory.",
        "Read only the minimum layer needed to act correctly.",
        `Prefer ${manifest.admin.name}'s latest explicit correction and the most specific project file.`,
        "If the Capsule and route do not resolve uncertainty, move deeper through the listed order.",
        "Do not infer project relationships from navigation hubs.",
        "Put unresolved information under `Needs Confirmation`.",
      ]),
    ].join("\n"),
    [
      "## Default Read Strategy",
      "",
      [
        "Read this Recall Map and the matching project Capsule.",
        "Stop when the Capsule fully answers a low-risk, non-durable task.",
        "Read the Hub to locate authoritative memory nodes.",
        "Read Decisions and Rules when choices or future behavior matter.",
        "Read Context when identity, scope, definitions, or broader background matter.",
        "Read specialized files only for the domain they govern.",
        "Use imports or Git history only for provenance, conflicts, recovery, or version history.",
      ]
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n"),
    ].join("\n"),
    [
      "## System Recall Routes",
      "",
      "### Admin and Operator Preferences",
      "",
      `**Triggers:** admin, ${manifest.admin.name}, operator, owner, user preferences, working style, communication style, technical preferences, project ownership, admin correction`,
      "",
      `**Read Order:** ${wiki(plan.adminProfile.name)} → ${wiki(plan.system.get("Rules")!.name)}`,
      "",
      `Use this route when interpreting ${manifest.admin.name}'s preferences, authority, project boundaries, working style, or an admin-level correction. A newer explicit correction overrides older imported memory for the corrected claim.`,
      "",
      "### Memory Format and Consolidation",
      "",
      "**Triggers:** update format, decision note, correction, import batch, consolidation",
      "",
      `**Read Order:** ${wiki(plan.system.get("Update Format")!.name)} → ${wiki(plan.system.get("Rules")!.name)}`,
    ].join("\n"),
    plan.allProjects.length
      ? ["## Project Recall Routes", "", projectRoutes.join("\n\n---\n\n")].join("\n")
      : [
          "## Project Recall Routes",
          "",
          "_No project routes yet. `vulcanus add project` writes one for each new project._",
        ].join("\n"),
    [
      "## Deep Recall Conditions",
      "",
      "Use deeper layers when work changes architecture, scope, rules, visual identity, legal or content constraints, algorithms, safety behavior, project relationships, or durable memory. Also go deeper when sources conflict, the Capsule is insufficient, or provenance is required.",
    ].join("\n"),
    [
      "## Update After Work Conditions",
      "",
      "After meaningful work, perform recursive consolidation. Check the Capsule, Recall Map, Context, Decisions, Rules, relevant specialized files, deprecated information, and `Needs Confirmation`. Update only the affected nodes, then run `vulcanus doctor` and sync.",
    ].join("\n"),
  ]);

  // Seed, not managed: trigger words are hand-tuned memory. `vulcanus add`
  // appends new routes surgically instead of rewriting the file.
  return { path: plan.recallMap.path, content, kind: "seed" };
}

function adminProfileNote(plan: VaultPlan): GeneratedFile {
  const { admin, vault } = plan.manifest;
  const aliasLine = admin.aliases.length
    ? `In ${vault.name} context, \`admin\`, \`${admin.name}\`, and ${admin.aliases
        .map((alias) => `\`${alias}\``)
        .join(", ")} refer to the same person unless stated otherwise.`
    : `In ${vault.name} context, \`admin\` and \`${admin.name}\` refer to the same person unless stated otherwise.`;

  const languageLine =
    admin.language === "tr"
      ? "Turkish is the default conversational language unless the task or requested output requires another language."
      : "English is the default conversational language unless the task or requested output requires another language.";

  const content = joinSections([
    renderFrontmatter({
      type: "admin-profile",
      project: vault.name,
      status: "active",
      admin: admin.name,
      confidence: "confirmed",
      tags: [slugify(vault.name), "admin", "operator", slugify(admin.name)],
    }),
    `# ${plan.adminProfile.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Recall Map: ${wiki(plan.recallMap.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Identity",
      "",
      bulletList(
        [
          `Admin: ${admin.name}`,
          `${admin.name} is the owner and operator of ${vault.name}.`,
          aliasLine,
          admin.role ? `Working identity: \`${admin.role}\`` : "",
        ].filter(Boolean),
      ),
    ].join("\n"),
    [
      `## Role in ${vault.name}`,
      "",
      bulletList([
        `${admin.name} is the primary decision-maker for project memory.`,
        `${admin.name} is the final authority for project status, scope, ownership, naming, boundaries, and explicit exclusions.`,
        `${admin.name} can confirm, reject, redefine, remove, or restore durable memory.`,
        `A newer explicit correction from ${admin.name} overrides older imported memory for the corrected claim.`,
      ]),
    ].join("\n"),
    [
      "## Working Style",
      "",
      bulletList(
        admin.workingStyle.length
          ? admin.workingStyle
          : [
              "Prefer practical, direct, and iterative collaboration.",
              "Prefer task-ready prompts, actionable outputs, and exact next steps.",
              "Capture durable decisions and corrections after meaningful work.",
              "Prefer production-ready solutions without unnecessary overengineering.",
              "Follow project-specific rules and existing repository conventions before introducing new patterns.",
            ],
      ),
    ].join("\n"),
    [
      "## Communication Style",
      "",
      bulletList([
        languageLine,
        "Lead with the useful result, then provide clear actions or implementation details.",
        "Avoid unnecessary over-explanation and cold corporate language.",
      ]),
    ].join("\n"),
    [
      "## Technical Preferences",
      "",
      "These are default preferences. More specific project memory and existing repository conventions take priority.",
      "",
      bulletList(
        admin.technical.length
          ? admin.technical
          : ["_Not recorded yet. Add confirmed defaults as they emerge._"],
        "_Not recorded yet._",
      ),
    ].join("\n"),
    [
      "## AI Collaboration Rules",
      "",
      bulletList([
        `Use the ${vault.name} protocol for project work.`,
        `Start with ${wiki(plan.recallMap.name)} and the relevant Capsule; expand through the Hub and authoritative files only when needed.`,
        "If durable memory changes, update every affected node, run `vulcanus doctor`, and sync the approved changes.",
        `Treat an explicit correction from ${admin.name} as high-confidence memory for the corrected claim.`,
        "Put uncertainty under `Needs Confirmation` instead of inventing details.",
      ]),
    ].join("\n"),
    [
      "## Project Ownership and Boundary Rules",
      "",
      bulletList(
        admin.boundaries.length ? admin.boundaries : ["_No ownership boundaries recorded yet._"],
        "_No ownership boundaries recorded yet._",
      ),
    ].join("\n"),
    [
      "## Do Not Assume",
      "",
      bulletList([
        "Do not invent project details.",
        "Do not create new top-level projects without sufficient confirmation.",
        "Do not merge independent brands or infer ownership from graph navigation.",
        "Do not store sensitive personal details in this profile.",
        "Do not commit raw exports or copy raw conversations into durable memory.",
      ]),
    ].join("\n"),
    ["## Needs Confirmation", "", "- _Nothing pending._"].join("\n"),
  ]);

  return { path: plan.adminProfile.path, content, kind: "seed" };
}

function systemHubNote(plan: VaultPlan): GeneratedFile {
  const links = systemNoteKinds(plan.manifest).map((kind) => wiki(plan.system.get(kind)!.name));
  const content = joinSections([
    frontmatter(plan, "System Hub", ["hub"]),
    `# ${plan.systemHub.name}`,
    [
      "## Purpose",
      "",
      `Navigation point for ${plan.manifest.vault.name}'s own system layer: routing, protocol, operator profile, and memory-format notes.`,
    ].join("\n"),
    ["## System Notes", "", bulletList(links)].join("\n"),
    [
      "## Maintenance",
      "",
      bulletList([
        "Keep this hub linked to every system note so the graph has no isolated system nodes.",
        "Run `vulcanus doctor` after structural changes.",
      ]),
    ].join("\n"),
  ]);
  // Seed: a hub is a navigation note operators extend with their own links.
  return { path: plan.systemHub.path, content, kind: "seed" };
}

function vaultContextNote(plan: VaultPlan): GeneratedFile {
  const { vault, admin } = plan.manifest;
  const note = plan.system.get("Context")!;
  const content = joinSections([
    frontmatter(plan, "Context", ["context"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Index: ${wiki(plan.index.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## What This Vault Is",
      "",
      `${vault.name}${vault.fullName ? ` (${vault.fullName})` : ""} is an AI-readable second brain and recall archive. It stores durable project context, decisions, rules, constraints, and specialized knowledge in linked Markdown so humans and AI agents can resume work with reliable context.`,
    ].join("\n"),
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
      "## Operator",
      "",
      `${admin.name} is the vault owner and the final authority on durable memory. See ${wiki(plan.adminProfile.name)}.`,
    ].join("\n"),
    [
      "## Boundary",
      "",
      bulletList([
        "Durable, reusable knowledge belongs here.",
        "Casual chat, one-off commands, and temporary debugging do not.",
        "Unconfirmed information belongs under `Needs Confirmation`, never as fact.",
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function vaultRulesNote(plan: VaultPlan): GeneratedFile {
  const { vault, admin, structure } = plan.manifest;
  const note = plan.system.get("Rules")!;
  const content = joinSections([
    frontmatter(plan, "Rules", ["rules"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Context: ${wiki(plan.system.get("Context")!.name)}`,
        `Update Format: ${wiki(plan.system.get("Update Format")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Memory Rules",
      "",
      bulletList([
        "Store long-term reusable information only.",
        "Do not invent missing project facts.",
        `Prefer ${admin.name}'s latest explicit correction and the most specific project file.`,
        "Keep project boundaries clean; do not infer ownership from navigation hubs.",
        "Record uncertain items under `Needs Confirmation`.",
        "Do not add new projects without explicit confirmation.",
      ]),
    ].join("\n"),
    [
      "## Safety Rules",
      "",
      bulletList([
        `Never commit raw AI exports; \`${structure.importsDir}/\` raw sources stay ignored.`,
        `Never commit generated state under \`${structure.stateDir}/\`.`,
        "Preserve ignored local and sensitive files.",
        "Keep Markdown and Obsidian wiki links valid.",
        "Do not claim a commit or push succeeded unless it actually did.",
      ]),
    ].join("\n"),
    [
      "## Validation Rules",
      "",
      bulletList([
        "Every note carries `type`, `project`, `status`, and `tags` frontmatter.",
        "Every project note links back to its own Hub.",
        "Every project has a Capsule reachable from the Recall Map.",
        `Run \`vulcanus doctor\` before syncing ${vault.name}.`,
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function updateFormatNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Update Format")!;
  const { structure, admin } = plan.manifest;
  const content = joinSections([
    frontmatter(plan, "Update Format", ["update-format"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Purpose",
      "",
      "This note defines how conversations become durable memory. Use it whenever work produces something worth remembering.",
    ].join("\n"),
    [
      "## Basic Update Format",
      "",
      "```md",
      "# Update — [Project Name]",
      "",
      "## Date",
      "",
      "YYYY-MM-DD",
      "",
      "## Source",
      "",
      "conversation / user correction / project discussion",
      "",
      "## Target Files",
      "",
      "- `path/to/[Project] Context.md`",
      "",
      "## Summary",
      "",
      "Short summary of what changed.",
      "",
      "## Add / Update",
      "",
      "### Target: `path/to/file.md`",
      "",
      "Content to add or update.",
      "",
      "## Remove / Correct",
      "",
      "Content that should be removed, corrected, or replaced.",
      "",
      "## Needs Confirmation",
      "",
      "Unclear items that should not be stored as facts yet.",
      "```",
    ].join("\n"),
    [
      "## Decision Note Format",
      "",
      "```md",
      "## [Decision Title]",
      "",
      "### Decision",
      "",
      "Clear decision.",
      "",
      "### Details",
      "",
      "Supporting details.",
      "",
      "### Impact",
      "",
      "How this changes future work.",
      "```",
    ].join("\n"),
    [
      "## Correction Format",
      "",
      "```md",
      "## Correction — [Topic]",
      "",
      "### Old / Wrong",
      "",
      "What was wrong.",
      "",
      "### Correct",
      "",
      "Correct information.",
      "",
      "### Impact",
      "",
      "How future notes and responses should change.",
      "```",
    ].join("\n"),
    [
      "## Target File Selection",
      "",
      bulletList([
        "**Context** — project definition, scope, identity, known features, positioning.",
        "**Decisions** — confirmed decisions, corrections, relationship and naming rules.",
        "**Rules** — assistant behavior, product constraints, do/don't instructions.",
        "**Specialized** — architecture, flow, visual direction, content guidelines.",
        "**Capsule** — the compressed must-remember summary, updated last.",
      ]),
    ].join("\n"),
    [
      "## Import Processing Rules",
      "",
      "### Keep",
      "",
      bulletList([
        "project definitions and confirmed scope",
        "user corrections and technical preferences",
        "brand rules and visual direction",
        "reusable prompts and known mistakes to avoid",
        "important decisions",
      ]),
      "",
      "### Ignore",
      "",
      bulletList([
        "small talk and repeated drafts",
        "temporary debugging unless reusable",
        "one-off commands and outdated assumptions",
      ]),
      "",
      "### Mark as Needs Confirmation",
      "",
      bulletList([
        "unclear project relationships",
        "old information contradicted by newer notes",
        "uncertain naming or scope",
        "missing business or legal details",
      ]),
      "",
      `Raw exports stay under the ignored \`${structure.importsDir}/\` directory and are treated as untrusted source material. Only ${admin.name}-confirmed, durable memory is extracted into notes.`,
    ].join("\n"),
    [
      "## Update Checklist",
      "",
      "```txt",
      "Is this long-term useful?",
      "Will this change future AI understanding or behavior?",
      "Is the target project correct?",
      "Is it confirmed, or does it belong under Needs Confirmation?",
      "Does it conflict with newer information?",
      "Should the Capsule and Recall Map change for future fast recall?",
      "Did `vulcanus doctor` pass?",
      "```",
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function changelogNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Changelog")!;
  const today = new Date().toISOString().slice(0, 10);
  const content = joinSections([
    frontmatter(plan, "Changelog", ["changelog"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([`Hub: ${wiki(plan.systemHub.name)}`, `Index: ${wiki(plan.index.name)}`]),
    ].join("\n"),
    [
      "## Purpose",
      "",
      "Human-readable history of material changes to this vault's memory architecture and operating protocol.",
    ].join("\n"),
    [
      `## ${today} — Vault created`,
      "",
      bulletList([
        `Created ${plan.manifest.vault.name} with the Vulcanus generator.`,
        `Projects at creation: ${
          plan.allProjects.length
            ? plan.allProjects.map((project) => project.project.name).join(", ")
            : "none"
        }.`,
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function importLogNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Import Log")!;
  const records = plan.manifest.imports;
  const content = joinSections([
    frontmatter(plan, "Import Log", ["import-log"]),
    `# ${note.name}`,
    ["## Navigation", "", bulletList([`Hub: ${wiki(plan.systemHub.name)}`])].join("\n"),
    [
      "## Purpose",
      "",
      "Provenance for memory extracted from AI conversation exports. Raw exports are never committed and never copied into durable memory.",
    ].join("\n"),
    records.length
      ? [
          "## Imports",
          "",
          records
            .map((record) =>
              [
                `### ${record.date} — ${record.source}`,
                "",
                bulletList(
                  [
                    `Conversations scanned: ${record.conversations}`,
                    `Project candidates accepted: ${record.candidatesAccepted}`,
                    record.note ?? "",
                  ].filter(Boolean),
                ),
              ].join("\n"),
            )
            .join("\n\n"),
        ].join("\n")
      : ["## Imports", "", "_No import has been processed yet._"].join("\n"),
    [
      "## Safety Notes",
      "",
      bulletList([
        "Raw exports remain ignored and untracked.",
        "No raw conversation text is copied into durable memory.",
        "Statements that conflict with newer rules are not promoted as facts.",
      ]),
    ].join("\n"),
  ]);
  // Seed: the import log is provenance the operator and their agents write to.
  return { path: note.path, content, kind: "seed" };
}

function brainOsNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Brain OS Architecture")!;
  const content = joinSections([
    frontmatter(plan, "Brain OS Architecture", ["brain-os", "architecture"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([`Hub: ${wiki(plan.systemHub.name)}`, `Recall Map: ${wiki(plan.recallMap.name)}`]),
    ].join("\n"),
    [
      "## Purpose",
      "",
      "Define how this vault stores, routes, validates, and consolidates durable memory without loading the whole vault for every task.",
    ].join("\n"),
    [
      "## Memory Node Types",
      "",
      bulletList([
        "**capsule** — shortest verified project recall entry",
        "**hub** — local navigation and cluster boundary",
        "**context** — identity, definitions, and scope",
        "**decisions** — confirmed choices and corrections",
        "**rules** — future behavior and constraints",
        "**specialized** — domain depth such as architecture, flow, visual direction, or content",
        "**recall-map** — lexical routing to the minimum reliable memory layer",
        "**import-log** — provenance without raw exports",
        "**changelog** — material system and protocol history",
      ]),
    ].join("\n"),
    [
      "## Recall Layers",
      "",
      [
        "**Layer 0 — Capsule:** compressed, verified entry point.",
        "**Layer 1 — Hub:** cluster navigation and boundaries.",
        "**Layer 2 — Context / Decisions / Rules:** authoritative scope, choices, and constraints.",
        "**Layer 3 — Specialized:** domain-specific depth.",
        "**Layer 4 — Imports / Git:** provenance, recovery, and history.",
      ]
        .map((line, index) => `${index}. ${line}`)
        .join("\n"),
    ].join("\n"),
    [
      "## Recursive Consolidation Loop",
      "",
      "Recall → perform work → identify durable change → update only affected nodes → check Capsule, route, authority, links, and uncertainty → validate with `vulcanus doctor` → sync versioned memory.",
    ].join("\n"),
    [
      "## Safety Boundaries",
      "",
      bulletList([
        "Do not invent facts, products, projects, or relationships.",
        "Raw exports and sensitive raw data are not durable-memory nodes.",
        "`Needs Confirmation` is not fact.",
        "Do not replace detailed project memory with lossy summaries.",
        "Preserve project boundaries and explicit exclusions.",
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function operatingIntuitionNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Operating Intuition")!;
  const content = joinSections([
    frontmatter(plan, "Operating Intuition", ["intuition", "reflex"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Brain OS: ${wiki(plan.system.get("Brain OS Architecture")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Purpose",
      "",
      "Reflex layer for AI agents: what to notice before recall and after work. It guides attention but never replaces confirmed memory or source evidence.",
    ].join("\n"),
    [
      "## Before Work",
      "",
      bulletList([
        "Identify which project the request belongs to before answering.",
        "Read the smallest layer that can answer correctly.",
        "Notice when a request implies a durable change rather than a one-off task.",
        "Notice when the operator is correcting something previously recorded.",
      ]),
    ].join("\n"),
    [
      "## After Work",
      "",
      bulletList([
        "Ask whether durable knowledge changed; if not, do not edit memory just to show activity.",
        "Update the affected nodes only, then the Capsule for fast future recall.",
        "Record leftover uncertainty under `Needs Confirmation`.",
        "Report what changed, what passed validation, and what is still open.",
      ]),
    ].join("\n"),
    [
      "## Failure Modes to Avoid",
      "",
      bulletList([
        "Answering from a stale summary when the authoritative note contradicts it.",
        "Promoting an idea into an active project without confirmation.",
        "Flattening distinct projects into one cluster.",
        "Over-summarizing detailed memory until it stops being useful.",
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function neuralLinkMapNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Neural Link Map")!;
  const content = joinSections([
    frontmatter(plan, "Neural Link Map", ["graph", "links"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Brain OS: ${wiki(plan.system.get("Brain OS Architecture")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Link Types",
      "",
      bulletList([
        "**parent-child** — hierarchy between a cluster and a node inside it",
        "**sibling** — navigation between peers with the same parent",
        "**recall-route** — trigger-to-entry path used during retrieval",
        "**decision-supports-rule** — a confirmed choice justifies future behavior",
        "**context-defines-scope** — context establishes the boundary another node applies in",
        "**specialized-deepens-topic** — domain detail without replacing authority",
        "**needs-confirmation** — an explicit path to uncertainty that is not fact",
      ]),
    ].join("\n"),
    [
      "## Linking Rules",
      "",
      bulletList([
        "Prefer local, typed links over dense global cross-linking.",
        "Add a cross-cluster link only when it shortens a real recall route or resolves scope.",
        "A navigation link never implies ownership between projects.",
      ]),
    ].join("\n"),
    ["## Cross-Cluster Links", "", "_None recorded yet._"].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function confidenceModelNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get("Memory Confidence Model")!;
  const content = joinSections([
    frontmatter(plan, "Memory Confidence Model", ["confidence", "trust"]),
    `# ${note.name}`,
    [
      "## Navigation",
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      "## Confidence Levels",
      "",
      bulletList([
        "**confirmed** — the operator explicitly stated or approved it.",
        "**corroborated** — repeated consistently across independent sources.",
        "**inferred** — derived from context; usable with a stated assumption.",
        "**needs-confirmation** — uncertain, contradicted, or single-source; never fact.",
      ]),
    ].join("\n"),
    [
      "## Resolution Rules",
      "",
      bulletList([
        "The latest explicit operator correction wins for the corrected claim.",
        "The most specific project file wins over a general one.",
        "A Capsule never outranks its source note.",
        "When two confirmed statements conflict, escalate to the operator instead of choosing silently.",
      ]),
    ].join("\n"),
    [
      "## Staleness",
      "",
      bulletList([
        "Externally sourced facts carry the date they were read.",
        "Re-verify time-sensitive facts before reusing them in outward-facing work.",
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

const SYSTEM_BUILDERS: Record<string, (plan: VaultPlan) => GeneratedFile> = {
  Index: indexNote,
  "Recall Map": recallMapNote,
  "Admin Profile": adminProfileNote,
  Context: vaultContextNote,
  Rules: vaultRulesNote,
  "Update Format": updateFormatNote,
  Changelog: changelogNote,
  "Import Log": importLogNote,
  "Brain OS Architecture": brainOsNote,
  "Operating Intuition": operatingIntuitionNote,
  "Neural Link Map": neuralLinkMapNote,
  "Memory Confidence Model": confidenceModelNote,
};

export function generateSystemNotes(plan: VaultPlan): GeneratedFile[] {
  const files: GeneratedFile[] = [systemHubNote(plan)];
  for (const kind of systemNoteKinds(plan.manifest)) {
    const builder = SYSTEM_BUILDERS[kind];
    if (builder) files.push(builder(plan));
  }
  return files;
}
