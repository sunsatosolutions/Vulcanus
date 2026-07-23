import * as p from "@clack/prompts";
import { enforcementSnippet } from "../generate/agents.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";

const TARGETS: Array<{ tool: string; where: string }> = [
  { tool: "Claude Code", where: "~/.claude/CLAUDE.md" },
  { tool: "Codex", where: "~/.codex/AGENTS.md" },
  { tool: "Cursor", where: "Settings → Rules → User Rules" },
  { tool: "ChatGPT", where: "Settings → Personalization → Custom instructions" },
  { tool: "Gemini CLI", where: "~/.gemini/GEMINI.md" },
];

export interface AgentsOptions {
  cwd?: string;
  /** Print only the snippet, so it can be piped straight into a file. */
  raw?: boolean;
}

export async function agentsCommand(options: AgentsOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    process.stderr.write("No vulcanus.json found. Run this inside a vault.\n");
    return 2;
  }

  const manifest = await readManifest(vaultRoot);
  const plan = buildPlan(manifest);
  const snippet = enforcementSnippet(plan, vaultRoot);

  if (options.raw) {
    process.stdout.write(`${snippet}\n`);
    return 0;
  }

  p.intro(`agents — ${manifest.vault.name}`);

  p.log.info(
    [
      "Agents working inside this repository already follow AGENTS.md, CLAUDE.md,",
      "and .cursor/rules. The block below is for everywhere else — paste it into",
      "your tool's global instructions so every session recalls this vault.",
    ].join("\n"),
  );

  // Printed plainly rather than inside a bordered box: the lines are long, and a
  // box would both wrap badly and put frame characters into a copied selection.
  const rule = "─".repeat(Math.min(process.stdout.columns ?? 80, 100));
  process.stdout.write(`\n${rule}\n${snippet}\n${rule}\n\n`);

  p.note(
    TARGETS.map((target) => `${target.tool.padEnd(12)} ${target.where}`).join("\n"),
    "Where it goes",
  );

  p.log.message("Pipe it straight to a file with:\n  vulcanus agents --raw >> ~/.claude/CLAUDE.md");

  p.outro("See USING-WITH-AI.md in the vault for the full guide.");
  return 0;
}
