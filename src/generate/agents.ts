import type { VaultPlan } from "../manifest/derive.js";
import { bulletList, joinSections } from "../util/text.js";
import type { GeneratedFile } from "./types.js";

/**
 * The block an operator pastes into a tool's *global* instructions. This is what
 * turns "the vault exists" into "every session actually uses it", so it is
 * generated into the vault, printed by `vulcanus agents`, and kept identical in
 * both places.
 */
export function enforcementSnippet(plan: VaultPlan, vaultPath: string): string {
  const { vault, admin } = plan.manifest;

  return [
    `## ${vault.name} is my second brain — use it in every session`,
    "",
    `I maintain **${vault.name}**, an AI-readable memory vault at \`${vaultPath}\`. Using it is a standing requirement, not an optional extra.`,
    "",
    `- **Before** working on anything related to my projects, recall from it first: read \`${vaultPath}/AGENTS.md\`, then route through the Recall Map → the matching project Capsule → Hub → Context, Decisions, and Rules. Treat ${vault.name} as the source of truth, and prefer my latest explicit correction and the most specific project file when sources conflict.`,
    `- **After** work that creates durable knowledge, consolidate it into the correct note, then run \`vulcanus doctor\` and \`vulcanus sync "topic"\` with my approval.`,
    `- Never record uncertain information as fact. Put it under \`Needs Confirmation\`.`,
    `- Do not add new projects or project relationships without my explicit confirmation.`,
    `- ${admin.name} is the operator and the final authority on what the vault records.`,
  ].join("\n");
}

/** Claude Code reads CLAUDE.md automatically when working inside the vault. */
function claudeFile(plan: VaultPlan): GeneratedFile {
  const { vault } = plan.manifest;
  const content = joinSections([
    `# ${vault.name}`,
    `This repository is ${vault.name}, an AI-readable memory vault.`,
    `**Follow [\`AGENTS.md\`](AGENTS.md).** It is the full protocol for reading, updating, and validating this vault, and it applies to every task here.`,
    [
      "## Quick reference",
      "",
      bulletList([
        "Recall before work; consolidate after work only when durable knowledge changed.",
        "Read the smallest reliable layer: Recall Map → Capsule → Hub → Context/Decisions/Rules.",
        "Uncertain information goes under `Needs Confirmation`, never into a note as fact.",
        "Run `vulcanus doctor` after structural changes; it must pass before `vulcanus sync`.",
      ]),
    ].join("\n"),
  ]);

  return { path: "CLAUDE.md", content, kind: "managed" };
}

/** Cursor picks up rules files inside the workspace. */
function cursorRuleFile(plan: VaultPlan): GeneratedFile {
  const { vault } = plan.manifest;
  const content = [
    "---",
    `description: ${vault.name} memory vault protocol`,
    "alwaysApply: true",
    "---",
    "",
    `This repository is ${vault.name}, an AI-readable memory vault. Follow AGENTS.md for every task.`,
    "",
    "Recall before work: read the Recall Map, then the matching project Capsule, then expand only as needed.",
    "Update after work only when durable knowledge changed, and put uncertainty under `Needs Confirmation`.",
    "Validate with `vulcanus doctor` before committing.",
    "",
  ].join("\n");

  return { path: ".cursor/rules/vault.mdc", content, kind: "managed" };
}

/** Human-facing setup guide: how to make agents actually use the vault. */
function usingWithAiFile(plan: VaultPlan): GeneratedFile {
  const { vault } = plan.manifest;
  const vaultPath = `/path/to/${vault.name}`;

  const content = joinSections([
    `# Using ${vault.name} with AI`,
    `A vault only pays off when your assistants actually read it. There are two levels: agents working **inside** this repository, which is already handled, and agents working **anywhere else**, which you have to switch on once.`,
    [
      "## Already handled — agents working in this repository",
      "",
      "These files ship with the vault and are picked up automatically:",
      "",
      bulletList([
        "`AGENTS.md` — the full protocol. Read by Codex, Cursor, Claude Code, and most agent tooling.",
        "`CLAUDE.md` — points Claude Code at the protocol.",
        "`.cursor/rules/vault.mdc` — the same instruction for Cursor.",
      ]),
      "",
      "So if you open this folder in an AI coding tool and ask it to update your memory, it already knows the rules.",
    ].join("\n"),
    [
      "## The important part — making it mandatory everywhere",
      "",
      `Most of your work happens in *other* repositories and in ordinary chat. To make an assistant recall ${vault.name} there too, paste the block below into that tool's **global** instructions. Run \`vulcanus agents\` to print it with your real vault path filled in.`,
      "",
      "```md",
      enforcementSnippet(plan, vaultPath),
      "```",
    ].join("\n"),
    [
      "## Where each tool keeps its global instructions",
      "",
      "| Tool | Where to paste |",
      "| --- | --- |",
      "| Claude Code | `~/.claude/CLAUDE.md` |",
      "| Codex | `~/.codex/AGENTS.md` |",
      "| Cursor | Settings → Rules → User Rules |",
      "| ChatGPT | Settings → Personalization → Custom instructions |",
      "| Gemini CLI | `~/.gemini/GEMINI.md` |",
      "",
      "Anything that accepts standing instructions works the same way: the rule is simply *recall before, consolidate after*.",
    ].join("\n"),
    [
      "## Keeping it honest",
      "",
      bulletList([
        "`vulcanus doctor` — validate structure, links, and coverage.",
        '`vulcanus sync "topic"` — validate, then commit and push.',
        "`vulcanus add project` — add a project and wire it into the graph.",
        "`vulcanus import` — propose more projects from an AI export.",
      ]),
      "",
      "An agent that follows the protocol will run these itself. If validation fails, it must fix the vault before committing.",
    ].join("\n"),
    [
      "## Opening the vault in Obsidian",
      "",
      "This folder is a valid Obsidian vault as-is: open Obsidian, choose **Open folder as vault**, and select it. Wikilinks, shortest-path linking, and rename-safe links are configured already.",
      "",
      "The graph view is the fastest way to see whether your memory is healthy — clusters per project, hubs at the center, and isolated notes standing out immediately. You can edit any note there and the changes are just Markdown, so the CLI and your AI agents see them straight away.",
    ].join("\n"),
  ]);

  return { path: "USING-WITH-AI.md", content, kind: "seed" };
}

export function generateAgentFiles(plan: VaultPlan): GeneratedFile[] {
  return [claudeFile(plan), cursorRuleFile(plan), usingWithAiFile(plan)];
}
