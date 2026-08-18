import type { VaultPlan, ProjectPlan } from "../manifest/derive.js";
import { systemNoteKinds } from "../manifest/derive.js";
import { renderFrontmatter } from "../util/markdown.js";
import { bulletList, joinSections, slugify } from "../util/text.js";
import { renderTree } from "../util/tree.js";
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
    return t("system.projectOverview.1");
  }

  const lines: string[] = [];
  const walk = (project: ProjectPlan, depth: number) => {
    const heading = "#".repeat(Math.min(depth + 3, 6));
    lines.push(`${heading} ${project.project.name}`);
    lines.push("");
    lines.push(project.project.summary || t("system.projectOverview.2"));
    lines.push("");
    for (const child of project.children) walk(child, depth + 1);
  };

  const grouped = new Set<string>();
  for (const group of plan.groups) {
    lines.push(`### ${group.group.name}`);
    lines.push("");
    lines.push(
      group.group.summary || (group.group.navigationOnly ? t("system.projectOverview.3") : ""),
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
    mainHubs.push(plan.system.get(t("system.indexNote.1"))!.name);
    mainHubs.push(plan.system.get(t("system.indexNote.2"))!.name);
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
      t("system.indexNote.3", { name: manifest.vault.name, name2: manifest.admin.name }),
    "---",
    [
      t.heading("Operating Principle"),
      "",
      t("system.indexNote.4", { name: manifest.vault.name }),
      "",
      t("system.indexNote.5", { name: wiki(plan.systemHub.name) }),
    ].join("\n"),
    "---",
    [t.heading("Main Hubs"), "", bulletList(mainHubs.map(wiki))].join("\n"),
    "---",
    [t.heading("Active Project Overview"), "", projectOverview(plan)].join("\n"),
    "---",
    [
      t.heading("Current Vault Tree"),
      "",
      "```txt",
      renderTree(manifest.vault.name, treePaths),
      "```",
    ].join("\n"),
    "---",
    [
      t.heading("Global Rules"),
      "",
      bulletList([
        t("system.indexNote.6", { name: manifest.vault.name }),
        t("system.indexNote.7"),
        t("system.indexNote.8"),
        t("system.indexNote.9", { name: manifest.admin.name }),
        t("system.indexNote.10"),
        t("system.indexNote.11"),
        t("system.indexNote.12"),
        t("system.indexNote.13"),
      ]),
    ].join("\n"),
    "---",
    [
      t.heading("Short Principle"),
      "",
      t("system.indexNote.14", { name: manifest.vault.name }),
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
    ? t("system.recallRouteSection.1", {
        value: project.specialized.map((entry) => wiki(entry.note.name)).join(" and "),
      })
    : "";

  return [
    `### ${project.project.name}`,
    "",
    t("system.recallRouteSection.2"),
    "",
    bulletList(triggers),
    "",
    t("system.recallRouteSection.3"),
    "",
    readOrder.map((name, index) => `${index + 1}. ${wiki(name)}`).join("\n"),
    specializedLine,
    t("system.recallRouteSection.4"),
    "",
    bulletList([
      t("system.recallRouteSection.5"),
      t("system.recallRouteSection.6"),
      t("system.recallRouteSection.7"),
      t("system.recallRouteSection.8"),
    ]),
    "",
    t("system.recallRouteSection.9"),
    "",
    bulletList([
      t("system.recallRouteSection.10", { name: plan.manifest.admin.name }),
      t("system.recallRouteSection.11"),
    ]),
  ].join("\n");
}

function recallMapNote(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;

  const projectRoutes = plan.allProjects.map((project) => recallRouteSection(plan, project));

  const content = joinSections([
    frontmatter(plan, "Recall Map", ["recall", "routing"]),
    `# ${plan.recallMap.name}`,
    [t.heading("Purpose"), "", t("system.recallMapNote.1")].join("\n"),
    [
      t.heading("Recall Principles"),
      "",
      bulletList([
        t("system.recallMapNote.2"),
        t("system.recallMapNote.3"),
        t("system.recallMapNote.4", { name: manifest.admin.name }),
        t("system.recallMapNote.5"),
        t("system.recallMapNote.6"),
        t("system.recallMapNote.7"),
      ]),
    ].join("\n"),
    [
      t.heading("Default Read Strategy"),
      "",
      [
        t("system.recallMapNote.8"),
        t("system.recallMapNote.9"),
        t("system.recallMapNote.10"),
        t("system.recallMapNote.11"),
        t("system.recallMapNote.12"),
        t("system.recallMapNote.13"),
        t("system.recallMapNote.14"),
      ]
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n"),
    ].join("\n"),
    [
      t.heading("System Recall Routes"),
      "",
      t("system.recallMapNote.15"),
      "",
      t("system.recallMapNote.16", { name: manifest.admin.name }),
      "",
      t("system.recallMapNote.17", {
        name: wiki(plan.adminProfile.name),
        name2: wiki(plan.system.get("Rules")!.name),
      }),
      "",
      t("system.recallMapNote.18", { name: manifest.admin.name }),
      "",
      t("system.recallMapNote.19"),
      "",
      t("system.recallMapNote.20"),
      "",
      t("system.recallMapNote.21", {
        name: wiki(plan.system.get("Update Format")!.name),
        name2: wiki(plan.system.get("Rules")!.name),
      }),
    ].join("\n"),
    plan.allProjects.length
      ? [t.heading("Project Recall Routes"), "", projectRoutes.join("\n\n---\n\n")].join("\n")
      : [t.heading("Project Recall Routes"), "", t("system.recallMapNote.22")].join("\n"),
    [t.heading("Deep Recall Conditions"), "", t("system.recallMapNote.23")].join("\n"),
    [t.heading("Update After Work Conditions"), "", t("system.recallMapNote.24")].join("\n"),
  ]);

  // Seed, not managed: trigger words are hand-tuned memory. `vulcanus add`
  // appends new routes surgically instead of rewriting the file.
  return { path: plan.recallMap.path, content, kind: "seed" };
}

function adminProfileNote(plan: VaultPlan): GeneratedFile {
  const { admin, vault } = plan.manifest;
  const aliasLine = admin.aliases.length
    ? t("system.adminProfileNote.1", {
        name: vault.name,
        name2: admin.name,
        value: admin.aliases.map((alias) => `\`${alias}\``).join(", "),
      })
    : t("system.adminProfileNote.2", { name: vault.name, name2: admin.name });

  const languageLine =
    admin.language === "tr" ? t("system.adminProfileNote.3") : t("system.adminProfileNote.4");

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
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        t("system.adminProfileNote.5", { name: wiki(plan.recallMap.name) }),
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      t.heading("Identity"),
      "",
      bulletList(
        [
          `Admin: ${admin.name}`,
          t("system.adminProfileNote.6", { name: admin.name, name2: vault.name }),
          aliasLine,
          admin.role ? t("system.adminProfileNote.7", { role: admin.role }) : "",
        ].filter(Boolean),
      ),
    ].join("\n"),
    [
      t("system.adminProfileNote.8", { name: vault.name }),
      "",
      bulletList([
        t("system.adminProfileNote.9", { name: admin.name }),
        t("system.adminProfileNote.10", { name: admin.name }),
        t("system.adminProfileNote.11", { name: admin.name }),
        t("system.adminProfileNote.12", { name: admin.name }),
      ]),
    ].join("\n"),
    [
      t.heading("Working Style"),
      "",
      bulletList(
        admin.workingStyle.length
          ? admin.workingStyle
          : [
              t("system.adminProfileNote.13"),
              t("system.adminProfileNote.14"),
              t("system.adminProfileNote.15"),
              t("system.adminProfileNote.16"),
              t("system.adminProfileNote.17"),
            ],
      ),
    ].join("\n"),
    [
      t.heading("Communication Style"),
      "",
      bulletList([languageLine, t("system.adminProfileNote.18"), t("system.adminProfileNote.19")]),
    ].join("\n"),
    [
      t.heading("Technical Preferences"),
      "",
      t("system.adminProfileNote.20"),
      "",
      bulletList(
        admin.technical.length ? admin.technical : [t("system.adminProfileNote.21")],
        t("system.adminProfileNote.22"),
      ),
    ].join("\n"),
    [
      t.heading("AI Collaboration Rules"),
      "",
      bulletList([
        t("system.adminProfileNote.23", { name: vault.name }),
        t("system.adminProfileNote.24", { name: wiki(plan.recallMap.name) }),
        t("system.adminProfileNote.25"),
        t("system.adminProfileNote.26", { name: admin.name }),
        t("system.adminProfileNote.27"),
      ]),
    ].join("\n"),
    [
      t.heading("Project Ownership and Boundary Rules"),
      "",
      bulletList(
        admin.boundaries.length ? admin.boundaries : [t("system.adminProfileNote.28")],
        t("system.adminProfileNote.29"),
      ),
    ].join("\n"),
    [
      t.heading("Do Not Assume"),
      "",
      bulletList([
        t("system.adminProfileNote.30"),
        t("system.adminProfileNote.31"),
        t("system.adminProfileNote.32"),
        t("system.adminProfileNote.33"),
        t("system.adminProfileNote.34"),
      ]),
    ].join("\n"),
    [t.heading("Needs Confirmation"), "", t("system.adminProfileNote.35")].join("\n"),
  ]);

  return { path: plan.adminProfile.path, content, kind: "seed" };
}

function systemHubNote(plan: VaultPlan): GeneratedFile {
  const links = systemNoteKinds(plan.manifest).map((kind) => wiki(plan.system.get(kind)!.name));
  const content = joinSections([
    frontmatter(plan, "System Hub", ["hub"]),
    `# ${plan.systemHub.name}`,
    [
      t.heading("Purpose"),
      "",
      t("system.systemHubNote.1", { name: plan.manifest.vault.name }),
    ].join("\n"),
    [t.heading("System Notes"), "", bulletList(links)].join("\n"),
    [
      t.heading("Maintenance"),
      "",
      bulletList([t("system.systemHubNote.2"), t("system.systemHubNote.3")]),
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
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Index: ${wiki(plan.index.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      t.heading("What This Vault Is"),
      "",
      t("system.vaultContextNote.1", {
        name: vault.name,
        value: vault.fullName ? ` (${vault.fullName})` : "",
      }),
    ].join("\n"),
    [
      t.heading("Core Model"),
      "",
      bulletList([
        t("system.vaultContextNote.2"),
        t("system.vaultContextNote.3"),
        t("system.vaultContextNote.4"),
        t("system.vaultContextNote.5"),
        t("system.vaultContextNote.6"),
      ]),
    ].join("\n"),
    [
      t.heading("Operator"),
      "",
      t("system.vaultContextNote.7", { name: admin.name, name2: wiki(plan.adminProfile.name) }),
    ].join("\n"),
    [
      t.heading("Boundary"),
      "",
      bulletList([
        t("system.vaultContextNote.8"),
        t("system.vaultContextNote.9"),
        t("system.vaultContextNote.10"),
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
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Context: ${wiki(plan.system.get("Context")!.name)}`,
        t("system.vaultRulesNote.1", { name: wiki(plan.system.get("Update Format")!.name) }),
      ]),
    ].join("\n"),
    [
      t.heading("Memory Rules"),
      "",
      bulletList([
        t("system.vaultRulesNote.2"),
        t("system.vaultRulesNote.3"),
        t("system.vaultRulesNote.4", { name: admin.name }),
        t("system.vaultRulesNote.5"),
        t("system.vaultRulesNote.6"),
        t("system.vaultRulesNote.7"),
      ]),
    ].join("\n"),
    [
      t.heading("Safety Rules"),
      "",
      bulletList([
        t("system.vaultRulesNote.8", { importsDir: structure.importsDir }),
        t("system.vaultRulesNote.9", { stateDir: structure.stateDir }),
        t("system.vaultRulesNote.10"),
        t("system.vaultRulesNote.11"),
        t("system.vaultRulesNote.12"),
      ]),
    ].join("\n"),
    [
      t.heading("Validation Rules"),
      "",
      bulletList([
        t("system.vaultRulesNote.13"),
        t("system.vaultRulesNote.14"),
        t("system.vaultRulesNote.15"),
        t("system.vaultRulesNote.16", { name: vault.name }),
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function updateFormatNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get(t("system.updateFormatNote.1"))!;
  const { structure, admin } = plan.manifest;
  const content = joinSections([
    frontmatter(plan, t("system.updateFormatNote.2"), ["update-format"]),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [t.heading("Purpose"), "", t("system.updateFormatNote.3")].join("\n"),
    [
      t.heading("Basic Update Format"),
      "",
      "```md",
      t("system.updateFormatNote.4"),
      "",
      t.heading("Date"),
      "",
      "YYYY-MM-DD",
      "",
      t.heading("Source"),
      "",
      t("system.updateFormatNote.5"),
      "",
      t.heading("Target Files"),
      "",
      t("system.updateFormatNote.6"),
      "",
      t.heading("Summary"),
      "",
      t("system.updateFormatNote.7"),
      "",
      t.heading("Add / Update"),
      "",
      t("system.updateFormatNote.8"),
      "",
      t("system.updateFormatNote.9"),
      "",
      t.heading("Remove / Correct"),
      "",
      t("system.updateFormatNote.10"),
      "",
      t.heading("Needs Confirmation"),
      "",
      t("system.updateFormatNote.11"),
      "```",
    ].join("\n"),
    [
      t.heading("Decision Note Format"),
      "",
      "```md",
      t.heading("[Decision Title]"),
      "",
      t("system.updateFormatNote.12"),
      "",
      t("system.updateFormatNote.13"),
      "",
      "### Details",
      "",
      t("system.updateFormatNote.14"),
      "",
      "### Impact",
      "",
      t("system.updateFormatNote.15"),
      "```",
    ].join("\n"),
    [
      t.heading("Correction Format"),
      "",
      "```md",
      t.heading("Correction — [Topic]"),
      "",
      t("system.updateFormatNote.16"),
      "",
      t("system.updateFormatNote.17"),
      "",
      "### Correct",
      "",
      t("system.updateFormatNote.18"),
      "",
      "### Impact",
      "",
      t("system.updateFormatNote.19"),
      "```",
    ].join("\n"),
    [
      t.heading("Target File Selection"),
      "",
      bulletList([
        t("system.updateFormatNote.20"),
        t("system.updateFormatNote.21"),
        t("system.updateFormatNote.22"),
        t("system.updateFormatNote.23"),
        t("system.updateFormatNote.24"),
      ]),
    ].join("\n"),
    [
      t.heading("Import Processing Rules"),
      "",
      "### Keep",
      "",
      bulletList([
        t("system.updateFormatNote.25"),
        t("system.updateFormatNote.26"),
        t("system.updateFormatNote.27"),
        t("system.updateFormatNote.28"),
        t("system.updateFormatNote.29"),
      ]),
      "",
      "### Ignore",
      "",
      bulletList([
        t("system.updateFormatNote.30"),
        t("system.updateFormatNote.31"),
        t("system.updateFormatNote.32"),
      ]),
      "",
      t("system.updateFormatNote.33"),
      "",
      bulletList([
        t("system.updateFormatNote.34"),
        t("system.updateFormatNote.35"),
        t("system.updateFormatNote.36"),
        t("system.updateFormatNote.37"),
      ]),
      "",
      t("system.updateFormatNote.38", { importsDir: structure.importsDir, name: admin.name }),
    ].join("\n"),
    [
      t.heading("Update Checklist"),
      "",
      "```txt",
      t("system.updateFormatNote.39"),
      t("system.updateFormatNote.40"),
      t("system.updateFormatNote.41"),
      t("system.updateFormatNote.42"),
      t("system.updateFormatNote.43"),
      t("system.updateFormatNote.44"),
      t("system.updateFormatNote.45"),
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
      t.heading("Navigation"),
      "",
      bulletList([`Hub: ${wiki(plan.systemHub.name)}`, `Index: ${wiki(plan.index.name)}`]),
    ].join("\n"),
    [t.heading("Purpose"), "", t("system.changelogNote.1")].join("\n"),
    [
      t("system.changelogNote.2", { today: today }),
      "",
      bulletList([
        t("system.changelogNote.3", { name: plan.manifest.vault.name }),
        t("system.changelogNote.4", {
          value: plan.allProjects.length
            ? plan.allProjects.map((project) => project.project.name).join(", ")
            : "none",
        }),
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
    [t.heading("Navigation"), "", bulletList([`Hub: ${wiki(plan.systemHub.name)}`])].join("\n"),
    [t.heading("Purpose"), "", t("system.importLogNote.1")].join("\n"),
    records.length
      ? [
          t.heading("Imports"),
          "",
          records
            .map((record) =>
              [
                `### ${record.date} — ${record.source}`,
                "",
                bulletList(
                  [
                    t("system.importLogNote.2", { conversations: record.conversations }),
                    t("system.importLogNote.3", { candidatesAccepted: record.candidatesAccepted }),
                    record.note ?? "",
                  ].filter(Boolean),
                ),
              ].join("\n"),
            )
            .join("\n\n"),
        ].join("\n")
      : [t.heading("Imports"), "", t("system.importLogNote.4")].join("\n"),
    [
      t.heading("Safety Notes"),
      "",
      bulletList([
        t("system.importLogNote.5"),
        t("system.importLogNote.6"),
        t("system.importLogNote.7"),
      ]),
    ].join("\n"),
  ]);
  // Seed: the import log is provenance the operator and their agents write to.
  return { path: note.path, content, kind: "seed" };
}

function brainOsNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get(t("system.brainOsNote.1"))!;
  const content = joinSections([
    frontmatter(plan, t("system.brainOsNote.2"), ["brain-os", "architecture"]),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        t("system.brainOsNote.3", { name: wiki(plan.recallMap.name) }),
      ]),
    ].join("\n"),
    [t.heading("Purpose"), "", t("system.brainOsNote.4")].join("\n"),
    [
      t.heading("Memory Node Types"),
      "",
      bulletList([
        t("system.brainOsNote.5"),
        t("system.brainOsNote.6"),
        t("system.brainOsNote.7"),
        t("system.brainOsNote.8"),
        t("system.brainOsNote.9"),
        t("system.brainOsNote.10"),
        t("system.brainOsNote.11"),
        t("system.brainOsNote.12"),
        t("system.brainOsNote.13"),
      ]),
    ].join("\n"),
    [
      t.heading("Recall Layers"),
      "",
      [
        t("system.brainOsNote.14"),
        t("system.brainOsNote.15"),
        t("system.brainOsNote.16"),
        t("system.brainOsNote.17"),
        t("system.brainOsNote.18"),
      ]
        .map((line, index) => `${index}. ${line}`)
        .join("\n"),
    ].join("\n"),
    [t.heading("Recursive Consolidation Loop"), "", t("system.brainOsNote.19")].join("\n"),
    [
      t.heading("Safety Boundaries"),
      "",
      bulletList([
        t("system.brainOsNote.20"),
        t("system.brainOsNote.21"),
        t("system.brainOsNote.22"),
        t("system.brainOsNote.23"),
        t("system.brainOsNote.24"),
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function operatingIntuitionNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get(t("system.operatingIntuitionNote.1"))!;
  const content = joinSections([
    frontmatter(plan, t("system.operatingIntuitionNote.2"), ["intuition", "reflex"]),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Brain OS: ${wiki(plan.system.get("Brain OS Architecture")!.name)}`,
      ]),
    ].join("\n"),
    [t.heading("Purpose"), "", t("system.operatingIntuitionNote.3")].join("\n"),
    [
      t.heading("Before Work"),
      "",
      bulletList([
        t("system.operatingIntuitionNote.4"),
        t("system.operatingIntuitionNote.5"),
        t("system.operatingIntuitionNote.6"),
        t("system.operatingIntuitionNote.7"),
      ]),
    ].join("\n"),
    [
      t.heading("After Work"),
      "",
      bulletList([
        t("system.operatingIntuitionNote.8"),
        t("system.operatingIntuitionNote.9"),
        t("system.operatingIntuitionNote.10"),
        t("system.operatingIntuitionNote.11"),
      ]),
    ].join("\n"),
    [
      t.heading("Failure Modes to Avoid"),
      "",
      bulletList([
        t("system.operatingIntuitionNote.12"),
        t("system.operatingIntuitionNote.13"),
        t("system.operatingIntuitionNote.14"),
        t("system.operatingIntuitionNote.15"),
      ]),
    ].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function neuralLinkMapNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get(t("system.neuralLinkMapNote.1"))!;
  const content = joinSections([
    frontmatter(plan, t("system.neuralLinkMapNote.2"), ["graph", "links"]),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Brain OS: ${wiki(plan.system.get("Brain OS Architecture")!.name)}`,
      ]),
    ].join("\n"),
    [
      t.heading("Link Types"),
      "",
      bulletList([
        t("system.neuralLinkMapNote.3"),
        t("system.neuralLinkMapNote.4"),
        t("system.neuralLinkMapNote.5"),
        t("system.neuralLinkMapNote.6"),
        t("system.neuralLinkMapNote.7"),
        t("system.neuralLinkMapNote.8"),
        t("system.neuralLinkMapNote.9"),
      ]),
    ].join("\n"),
    [
      t.heading("Linking Rules"),
      "",
      bulletList([
        t("system.neuralLinkMapNote.10"),
        t("system.neuralLinkMapNote.11"),
        t("system.neuralLinkMapNote.12"),
      ]),
    ].join("\n"),
    [t.heading("Cross-Cluster Links"), "", t("system.neuralLinkMapNote.13")].join("\n"),
  ]);
  return { path: note.path, content, kind: "seed" };
}

function confidenceModelNote(plan: VaultPlan): GeneratedFile {
  const note = plan.system.get(t("system.confidenceModelNote.1"))!;
  const content = joinSections([
    frontmatter(plan, t("system.confidenceModelNote.2"), ["confidence", "trust"]),
    `# ${note.name}`,
    [
      t.heading("Navigation"),
      "",
      bulletList([
        `Hub: ${wiki(plan.systemHub.name)}`,
        `Rules: ${wiki(plan.system.get("Rules")!.name)}`,
      ]),
    ].join("\n"),
    [
      t.heading("Confidence Levels"),
      "",
      bulletList([
        t("system.confidenceModelNote.3"),
        t("system.confidenceModelNote.4"),
        t("system.confidenceModelNote.5"),
        t("system.confidenceModelNote.6"),
      ]),
    ].join("\n"),
    [
      t.heading("Resolution Rules"),
      "",
      bulletList([
        t("system.confidenceModelNote.7"),
        t("system.confidenceModelNote.8"),
        t("system.confidenceModelNote.9"),
        t("system.confidenceModelNote.10"),
      ]),
    ].join("\n"),
    [
      t.heading("Staleness"),
      "",
      bulletList([t("system.confidenceModelNote.11"), t("system.confidenceModelNote.12")]),
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
  t = noteText(plan.manifest.vault.language);
  const files: GeneratedFile[] = [systemHubNote(plan)];
  for (const kind of systemNoteKinds(plan.manifest)) {
    const builder = SYSTEM_BUILDERS[kind];
    if (builder) files.push(builder(plan));
  }
  return files;
}
