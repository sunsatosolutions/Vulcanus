import type { VaultPlan } from "../manifest/derive.js";
import { bulletList, joinSections, slugify } from "../util/text.js";
import type { GeneratedFile } from "./types.js";

/**
 * Skill directories, per tool family. Claude Code reads only its own directory;
 * Codex, Cursor, and Gemini CLI all read the vendor-neutral `.agents/skills`,
 * so writing both covers every tool that implements the Agent Skills standard
 * without duplicating the skill content itself.
 */
export const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

/** Home-relative equivalents of `SKILL_DIRS`, used by `vulcanus skills --install`. */
export const PERSONAL_SKILL_DIRS = ["~/.claude/skills", "~/.agents/skills"] as const;

export interface SkillDefinition {
  /** Directory name and frontmatter `name`: lowercase, hyphenated, ≤64 chars. */
  name: string;
  /** The only thing a model sees before deciding to load the skill. */
  description: string;
  body: string;
}

function fence(command: string): string {
  return ["```bash", command, "```"].join("\n");
}

/**
 * Skills installed outside the vault must say where the vault is; skills that
 * ship inside it must not, because the CLI already resolves the vault root from
 * the working directory and a baked-in path would be wrong after a move.
 */
function runLine(vaultPath: string | undefined, command: string): string {
  return fence(vaultPath ? `cd "${vaultPath}" && ${command}` : command);
}

function workingDirectory(vaultName: string, vaultPath: string | undefined): string {
  return vaultPath
    ? `Run every command from \`${vaultPath}\`. That is the ${vaultName} vault.`
    : `Run every command from this repository, which is the ${vaultName} vault. The CLI resolves the vault root by walking up to \`vulcanus.json\`.`;
}

const REPORTING =
  "Report the command's real output and exit code. Do not summarize it as success unless it exited 0, and never state that something was committed, pushed, or written unless the output says so.";

function recallSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault, admin } = plan.manifest;
  const slug = slugify(vault.name) || "vault";
  const location = vaultPath ? `\`${vaultPath}\`` : "this repository";

  return {
    name: `${slug}-recall`,
    description: `Recall durable project memory from the ${vault.name} vault before doing project work. Use when ${admin.name} mentions ${vault.name} or one of the projects it tracks, asks what was decided or agreed about a project, asks what the rules or scope of a project are, or starts work that needs prior context instead of a fresh guess. Reads the Recall Map, then the matching project Capsule, then deeper notes only as needed.`,
    body: joinSections([
      `Recall from ${vault.name}, ${admin.name}'s AI-readable memory vault at ${location}, before answering or acting on anything related to their projects.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      [
        "## Read order",
        "",
        [
          `Read \`AGENTS.md\` at the vault root. It is the full protocol and it overrides this skill where they differ.`,
          `Read the Recall Map (\`${plan.recallMap.path}\`) and match the request against its trigger words.`,
          "Read the matching project Capsule. Stop here when it fully answers a low-risk question.",
          "Read the project Hub to locate the authoritative notes in that cluster.",
          "Read Context, Decisions, and Rules when identity, scope, past choices, or future behavior matter.",
          "Read specialized notes (Architecture, Flow, Visual Direction, Content Guidelines) only for the domain they govern.",
        ]
          .map((step, index) => `${index + 1}. ${step}`)
          .join("\n"),
      ].join("\n"),
      [
        "## Rules",
        "",
        bulletList([
          `Treat ${vault.name} as the source of truth, and prefer ${admin.name}'s latest explicit correction and the most specific project file when sources conflict.`,
          "Read the smallest layer that answers correctly; do not load an entire cluster for a small question.",
          "Do not infer project ownership or relationships from navigation hubs.",
          "Never record uncertain information as fact. Uncertainty goes under `Needs Confirmation`.",
          `Do not add projects or project relationships without ${admin.name}'s explicit confirmation.`,
        ]),
      ].join("\n"),
      [
        "## After the work",
        "",
        `If durable knowledge changed, update the affected notes, then validate with the \`${slug}-doctor\` skill. Commit only through the \`${slug}-sync\` skill, and only after ${admin.name} approves.`,
      ].join("\n"),
      ["## Say what you read", "", "State which notes you recalled from, so the routing can be corrected when it sends you to the wrong place."].join("\n"),
    ]),
  };
}

function doctorSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault } = plan.manifest;
  const slug = slugify(vault.name) || "vault";

  return {
    name: `${slug}-doctor`,
    description: `Validate the ${vault.name} memory vault by running \`vulcanus doctor\`. Use after editing any note in ${vault.name}, before committing or syncing it, or when asked whether ${vault.name} is healthy, valid, consistent, or has broken links, missing frontmatter, or orphaned notes. Read-only: it reports problems and changes nothing unless repair is requested.`,
    body: joinSections([
      `Validate ${vault.name} by running the real CLI. Do not judge the vault's health by reading files yourself — \`vulcanus doctor\` derives every check from \`vulcanus.json\`, so it is the only accurate answer.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      ["## Run", "", runLine(vaultPath, "vulcanus doctor")].join("\n"),
      [
        "## Repair",
        "",
        "Only generated, CLI-owned files can be rewritten automatically. Notes holding actual memory are never touched by repair.",
        "",
        runLine(vaultPath, "vulcanus doctor --repair"),
        "",
        "Use `--repair` when doctor reports missing generated structure. Report what it rewrote.",
      ].join("\n"),
      [
        "## Report",
        "",
        REPORTING,
        "",
        bulletList([
          "Exit code 0 means the vault passed. Report the note and link counts.",
          "Exit code 1 means errors remain. List them and fix the underlying notes; do not sync a failing vault.",
          "Exit code 2 means no vault was found at that path.",
        ]),
      ].join("\n"),
    ]),
  };
}

function syncSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault, admin } = plan.manifest;
  const slug = slugify(vault.name) || "vault";

  return {
    name: `${slug}-sync`,
    description: `Validate, commit, and push the ${vault.name} memory vault by running \`vulcanus sync\`. Use when ${admin.name} asks to sync, save, commit, or push ${vault.name} after memory notes were updated. This writes to the Git remote, so it requires ${admin.name}'s explicit confirmation in the current conversation before it runs.`,
    body: joinSections([
      `Commit and push ${vault.name}. This is outward-facing: it publishes memory to the vault's Git remote and cannot be silently undone.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      [
        "## Confirmation is required",
        "",
        `Do not run \`vulcanus sync\` until ${admin.name} has confirmed it in this conversation. Standing instructions, an earlier session, or the fact that they asked you to update a note do not count as confirmation to push.`,
        "",
        "Before asking, show what would be committed:",
        "",
        runLine(vaultPath, 'vulcanus sync --dry-run'),
        "",
        `That validates and prints the pending changes without committing. Show ${admin.name} that list and the commit topic you intend to use, then ask.`,
      ].join("\n"),
      [
        "## Run",
        "",
        "After explicit approval:",
        "",
        runLine(vaultPath, 'vulcanus sync "short topic"'),
        "",
        "`sync` validates first and refuses to commit while errors remain, then commits everything in the working tree and pushes when `origin` is configured.",
      ].join("\n"),
      [
        "## Report",
        "",
        REPORTING,
        "",
        bulletList([
          "Report the commit hash exactly as printed.",
          "Report the push result exactly as printed. A commit without a push is a normal outcome and must be stated as such.",
          "If validation failed, report that nothing was committed and list the errors.",
        ]),
      ].join("\n"),
    ]),
  };
}

function addProjectSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault, admin } = plan.manifest;
  const slug = slugify(vault.name) || "vault";

  return {
    name: `${slug}-add-project`,
    description: `Add a new project cluster to the ${vault.name} vault with \`vulcanus add project\`. Use when ${admin.name} says to add, start, or begin tracking a project in ${vault.name}, or asks where a new piece of work should live. Creates notes and rewires the Recall Map and hubs, so it requires an explicitly confirmed project name and must never be run on a guess.`,
    body: joinSections([
      `Add a project cluster — Capsule, Hub, Context, Decisions, Rules — to ${vault.name} and wire it into the graph. The CLI does the wiring; do not create the notes by hand.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      [
        "## Confirm first",
        "",
        bulletList([
          `${admin.name} must state the exact project name. Do not infer a project from a passing mention, an idea, or a repository you happened to open.`,
          "Check whether the project already exists in the vault before adding it; a near-duplicate cluster is worse than none.",
          "One confirmed project per run. Do not batch in names that were not confirmed.",
        ]),
      ].join("\n"),
      [
        "## Run",
        "",
        runLine(vaultPath, 'vulcanus add project "Project Name"'),
        "",
        `This command then asks for a summary, hierarchy, grouping, specialized notes, and recall trigger words. Those answers are ${admin.name}'s to give: if you cannot pass their input through to an interactive prompt, do not attempt to answer for them — hand them the exact command above and let them run it.`,
      ].join("\n"),
      [
        "## Report",
        "",
        REPORTING,
        "",
        "Report which notes were created and which existing notes were patched, then validate with `vulcanus doctor`.",
      ].join("\n"),
    ]),
  };
}

function importSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault, admin } = plan.manifest;
  const slug = slugify(vault.name) || "vault";

  return {
    name: `${slug}-import`,
    description: `Propose new ${vault.name} projects from an existing AI conversation history with \`vulcanus import\`. Use when ${admin.name} asks to import their ChatGPT, Claude, Claude Code, or Codex history into ${vault.name}, or to backfill projects from past conversations. Conversations are read locally and discarded; only confirmed project names become notes.`,
    body: joinSections([
      `Turn an AI conversation export into project candidates for ${vault.name}. Nothing from the history is copied into the vault — the importer reduces conversations to candidate project names with evidence counts, and only the names ${admin.name} ticks become notes.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      [
        "## Run",
        "",
        runLine(vaultPath, "vulcanus import"),
        "",
        "With no options the CLI detects available sources itself. To point it at one explicitly:",
        "",
        runLine(vaultPath, "vulcanus import --source chatgpt --path /path/to/export"),
        "",
        "`--source` accepts `chatgpt`, `claude`, `claude-code`, or `codex`.",
      ].join("\n"),
      [
        "## The selection is the operator's",
        "",
        `The command presents candidates for ${admin.name} to tick, and the selection decides what enters durable memory. Do not answer that prompt on their behalf. If you cannot pass their input through, hand them the exact command and let them run it.`,
      ].join("\n"),
      [
        "## Report",
        "",
        REPORTING,
        "",
        "Report how many conversations were scanned and which projects were accepted. The Import Log records counts only, never conversation content.",
      ].join("\n"),
    ]),
  };
}

function updateSkill(plan: VaultPlan, vaultPath: string | undefined): SkillDefinition {
  const { vault, admin } = plan.manifest;
  const slug = slugify(vault.name) || "vault";

  return {
    name: `${slug}-update`,
    description: `Bring the ${vault.name} vault up to date with a newer Vulcanus CLI by running \`vulcanus update\`. Use when \`vulcanus doctor\` warns that the vault was generated by an older version, or when ${admin.name} asks to update or upgrade the vault's structure after installing a newer Vulcanus. Rewrites CLI-owned files, so it runs with \`--dry-run\` first and needs confirmation.`,
    body: joinSections([
      `Migrate ${vault.name} to the structure this Vulcanus release expects: run manifest migrations, refresh the files the CLI owns, create notes a newer version added, and re-stamp the generator version.`,
      ["## Where the vault is", "", workingDirectory(vault.name, vaultPath)].join("\n"),
      [
        "## Show the plan first",
        "",
        runLine(vaultPath, "vulcanus update --dry-run"),
        "",
        `Show ${admin.name} what it reports — files to create, files to refresh, notes left untouched, and notes the manifest no longer describes — and get their confirmation before writing.`,
      ].join("\n"),
      [
        "## Run",
        "",
        runLine(vaultPath, "vulcanus update"),
        "",
        `Notes holding actual memory are preserved; the command reports how many it left untouched. A vault written by a *newer* CLI is refused rather than downgraded.`,
      ].join("\n"),
      [
        "## Never use --force unsupervised",
        "",
        `\`vulcanus update --force\` also rewrites ${admin.name}'s own notes and destroys hand-written memory. Do not run it. If an update seems to need it, stop and explain why instead.`,
      ].join("\n"),
      [
        "## Report",
        "",
        REPORTING,
        "",
        "Report the version it moved from and to, what was created, what was refreshed, and what was preserved. Then validate with `vulcanus doctor`.",
      ].join("\n"),
    ]),
  };
}

/**
 * One skill per vault operation the CLI already exposes, plus the recall
 * routing. `vaultPath` is set only for skills installed outside the vault,
 * where the agent has no other way to know which directory to work in.
 */
export function buildSkills(plan: VaultPlan, vaultPath?: string): SkillDefinition[] {
  return [
    recallSkill(plan, vaultPath),
    doctorSkill(plan, vaultPath),
    syncSkill(plan, vaultPath),
    addProjectSkill(plan, vaultPath),
    importSkill(plan, vaultPath),
    updateSkill(plan, vaultPath),
  ];
}

/**
 * Agent Skills frontmatter: `name` and `description` only, both required by the
 * standard. The description is quoted because it is a single long sentence run
 * that may contain colons.
 */
export function renderSkill(skill: SkillDefinition): string {
  const description = skill.description.replace(/"/g, "'");
  return [
    "---",
    `name: ${skill.name}`,
    `description: "${description}"`,
    "---",
    "",
    skill.body,
  ].join("\n");
}

/**
 * Skills shipped inside the vault, in every directory the supported tools read.
 * Managed rather than seed: they wrap CLI commands and hold no memory, so
 * template fixes must reach existing vaults through `doctor --repair`.
 */
export function generateSkillFiles(plan: VaultPlan): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const skill of buildSkills(plan)) {
    const content = renderSkill(skill);
    for (const dir of SKILL_DIRS) {
      files.push({ path: `${dir}/${skill.name}/SKILL.md`, content, kind: "managed" });
    }
  }
  return files;
}
