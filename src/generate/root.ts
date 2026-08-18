import type { VaultPlan } from "../manifest/derive.js";
import { mergeProtocol } from "./merge.js";
import { PROTOCOL_VERSION } from "../version.js";
import { bulletList, joinSections } from "../util/text.js";
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

function mdLink(note: { name: string; path: string }): string {
  return `[\`${note.name}\`](${encodeURI(note.path)})`;
}

/**
 * The prose half of the visibility marker. `recall` warns an MCP client when it
 * hands over a private project, but an agent reading this file instead of
 * calling a tool would never learn the rule — and the private projects have to
 * be named somewhere an agent will actually look. Omitted entirely when the
 * vault marks nothing private, rather than shipping an empty heading.
 */
function projectVisibilitySection(plan: VaultPlan): string {
  const priv = plan.manifest.projects.filter((project) => project.visibility === "private");
  if (priv.length === 0) return "";

  return [
    t.heading("Project visibility"),
    "",
    t("root.projectVisibilitySection.1"),
    "",
    bulletList(priv.map((project) => project.name)),
    "",
    t("root.projectVisibilitySection.2"),
  ].join("\n");
}

function agentsFile(plan: VaultPlan): GeneratedFile {
  const { manifest } = plan;
  const { admin, vault, structure } = manifest;

  const content = joinSections([
    t("root.agentsFile.1", { name: vault.name }),
    t("root.agentsFile.2", { pROTOCOLVERSION: PROTOCOL_VERSION }),
    t("root.agentsFile.3", {
      name: vault.name,
      value: vault.fullName ? ` (${vault.fullName})` : "",
    }),
    [
      t.heading("Required workflow"),
      "",
      [
        t("root.agentsFile.4", { index: mdLink(plan.index), recallMap: mdLink(plan.recallMap) }),
        t("root.agentsFile.5", { name: vault.name, name2: admin.name }),
        t("root.agentsFile.6", { name: admin.name, adminProfile: mdLink(plan.adminProfile) }),
        t("root.agentsFile.7"),
        t("root.agentsFile.8"),
        t("root.agentsFile.9"),
        t("root.agentsFile.10"),
        t("root.agentsFile.11"),
        t("root.agentsFile.12"),
        t("root.agentsFile.13"),
      ]
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n"),
      "",
      t("root.agentsFile.14", { name: vault.name }),
    ].join("\n"),
    [
      t.heading("Durable memory boundary"),
      "",
      t("root.agentsFile.15", { name: vault.name }),
      "",
      t("root.agentsFile.16"),
    ].join("\n"),
    [
      t.heading("Token-efficient recall protocol"),
      "",
      bulletList([
        t("root.agentsFile.17", { recallMap: mdLink(plan.recallMap) }),
        t("root.agentsFile.18"),
        t("root.agentsFile.19"),
        t("root.agentsFile.20"),
        t("root.agentsFile.21"),
        t("root.agentsFile.22"),
      ]),
    ].join("\n"),
    [
      t.heading("Recursive consolidation"),
      "",
      t("root.agentsFile.23"),
      "",
      t("root.agentsFile.24", { value: mdLink(plan.system.get("Changelog")!) }),
    ].join("\n"),
    [
      t.heading("Structure"),
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
        t("root.agentsFile.25", { systemDir: structure.systemDir }),
        t("root.agentsFile.26", { projectsDir: structure.projectsDir }),
        t("root.agentsFile.27", { importsDir: structure.importsDir }),
        t("root.agentsFile.28"),
      ]),
    ].join("\n"),
    projectVisibilitySection(plan),
    [
      t.heading("Safety"),
      "",
      bulletList([
        t("root.agentsFile.29", {
          value: mdLink(plan.system.get("Rules")!),
          value2: mdLink(plan.system.get("Update Format")!),
        }),
        t("root.agentsFile.30"),
        t("root.agentsFile.31", { importsDir: structure.importsDir }),
        t("root.agentsFile.32", { stateDir: structure.stateDir }),
        t("root.agentsFile.33"),
        t("root.agentsFile.34"),
        t("root.agentsFile.35"),
        t("root.agentsFile.36"),
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
    vault.tagline ?? t("root.readmeFile.1", { name: vault.name }),
    [
      t.heading("Core Model"),
      "",
      bulletList([
        t("root.readmeFile.2"),
        t("root.readmeFile.3"),
        t("root.readmeFile.4"),
        t("root.readmeFile.5"),
        t("root.readmeFile.6"),
      ]),
    ].join("\n"),
    [
      t.heading("Vault Structure"),
      "",
      "```txt",
      renderTree(vault.name, [
        "AGENTS.md",
        "README.md",
        "vulcanus.json",
        `${structure.systemDir}/`,
        `${structure.projectsDir}/`,
        t("root.readmeFile.7", { importsDir: structure.importsDir }),
      ]),
      "```",
    ].join("\n"),
    [
      t.heading("Recall Workflow"),
      "",
      t("root.readmeFile.8"),
      "",
      [
        "[`AGENTS.md`](AGENTS.md)",
        mdLink(plan.recallMap),
        t("root.readmeFile.9"),
        t("root.readmeFile.10"),
        t("root.readmeFile.11"),
        t("root.readmeFile.12"),
      ]
        .map((entry, index) => `${index + 1}. ${entry}`)
        .join("\n"),
      "",
      t("root.readmeFile.13", { name: vault.name, name2: admin.name }),
    ].join("\n"),
    [
      t.heading("Maintenance"),
      "",
      "```bash",
      t("root.readmeFile.14"),
      "```",
      "",
      "```bash",
      t("root.readmeFile.15"),
      "```",
      "",
      t("root.readmeFile.16"),
    ].join("\n"),
    [
      t.heading("Adding Memory"),
      "",
      bulletList([
        t("root.readmeFile.17"),
        t("root.readmeFile.18"),
        t("root.readmeFile.19", { value: mdLink(plan.system.get("Update Format")!) }),
      ]),
    ].join("\n"),
    [
      t.heading("Safety"),
      "",
      bulletList([
        t("root.readmeFile.20"),
        t("root.readmeFile.21"),
        t("root.readmeFile.22"),
        t("root.readmeFile.23"),
        t("root.readmeFile.24"),
      ]),
    ].join("\n"),
    t("root.readmeFile.25"),
  ]);

  return { path: "README.md", content, kind: "seed" };
}

function gitignoreFile(plan: VaultPlan): GeneratedFile {
  const { structure } = plan.manifest;
  const content = [
    t("root.gitignoreFile.1"),
    `${structure.importsDir}/*`,
    `!${structure.importsDir}/README.md`,
    "",
    t("root.gitignoreFile.2"),
    `${structure.stateDir}/`,
    "",
    t("root.gitignoreFile.3"),
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
    t("root.importsReadme.1"),
    [
      t.heading("Rules"),
      "",
      bulletList([
        t("root.importsReadme.2"),
        t("root.importsReadme.3", { name: vault.name }),
        t("root.importsReadme.4"),
        t("root.importsReadme.5"),
      ]),
    ].join("\n"),
    [
      t.heading("Usage"),
      "",
      "```bash",
      t("root.importsReadme.6", { importsDir: structure.importsDir }),
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
  t = noteText(plan.manifest.vault.language);
  return [
    agentsFile(plan),
    readmeFile(plan),
    gitignoreFile(plan),
    importsReadme(plan),
    obsidianConfig(),
  ];
}
