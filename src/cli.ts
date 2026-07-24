#!/usr/bin/env node
import { Command } from "commander";
import { addProjectCommand } from "./commands/add.js";
import { agentsCommand } from "./commands/agents.js";
import { doctorCommand } from "./commands/doctor.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { skillsCommand } from "./commands/skills.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import type { ImportSourceId } from "./importers/index.js";
import type { Locale } from "./i18n.js";
import type { VaultProfile } from "./manifest/schema.js";
import { updateNotice } from "./update-check.js";
import { CLI_VERSION } from "./version.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("vulcanus")
    .description("Scaffold and maintain an AI-readable second-brain vault.")
    .version(CLI_VERSION);

  program
    .command("init", { isDefault: true })
    .description("Create a new vault by answering a few questions")
    .argument("[target]", "directory to create the vault in")
    .option("-l, --lang <locale>", "wizard language: tr or en")
    .option("-y, --yes", "skip the final confirmation")
    .option("--ai [cli]", "let a locally installed AI CLI write the project notes")
    .action(
      async (
        target: string | undefined,
        options: { lang?: string; yes?: boolean; ai?: string | boolean },
      ) => {
        const locale =
          options.lang === "tr" || options.lang === "en" ? (options.lang as Locale) : undefined;
        process.exitCode = await initCommand({
          target,
          locale,
          yes: options.yes,
          ai: options.ai,
        });
      },
    );

  program
    .command("doctor")
    .description("Validate the vault against its manifest")
    .option("--repair", "rewrite generated files before validating")
    .option("--json", "print the report as JSON")
    .action(async (options: { repair?: boolean; json?: boolean }) => {
      process.exitCode = await doctorCommand(options);
    });

  const add = program.command("add").description("Add memory nodes to an existing vault");
  add
    .command("project")
    .description("Add one or more projects and wire them into the graph")
    .argument("[names...]", "project names")
    .option("--ai [cli]", "let a locally installed AI CLI write the project notes")
    .action(async (names: string[], options: { ai?: string | boolean }) => {
      process.exitCode = await addProjectCommand({ names, ai: options.ai });
    });

  program
    .command("import")
    .description("Propose projects from an AI conversation export")
    .option("-s, --source <source>", "chatgpt | claude | claude-code | codex")
    .option("-p, --path <path>", "path to the export or session directory")
    .option("--ai [cli]", "let a locally installed AI CLI write the project notes")
    .action(async (options: { source?: string; path?: string; ai?: string | boolean }) => {
      process.exitCode = await importCommand({
        source: options.source as ImportSourceId | undefined,
        path: options.path,
        ai: options.ai,
      });
    });

  program
    .command("agents")
    .description("Print the block that makes your AI tools use this vault everywhere")
    .option("--raw", "print only the snippet, for piping into a file")
    .action(async (options: { raw?: boolean }) => {
      process.exitCode = await agentsCommand(options);
    });

  program
    .command("skills")
    .description("Agent skills that run this vault's commands, and where to install them")
    .option("--raw", "print the SKILL.md files themselves")
    .option("--install", "write them into your personal skill directories")
    .option("--force", "with --install, replace skills that already exist")
    .action(async (options: { raw?: boolean; install?: boolean; force?: boolean }) => {
      process.exitCode = await skillsCommand(options);
    });

  program
    .command("update")
    .description("Bring an existing vault up to date with this CLI version")
    .option("--dry-run", "show what would change without writing")
    .option("--force", "also rewrite your own notes (destructive)")
    .option("--profile <profile>", "switch the system layer: core or full")
    .option("--json", "print the summary as JSON")
    .action(
      async (options: { dryRun?: boolean; force?: boolean; profile?: string; json?: boolean }) => {
        const profile =
          options.profile === "core" || options.profile === "full"
            ? (options.profile as VaultProfile)
            : undefined;
        if (options.profile && !profile) {
          process.stderr.write("--profile must be 'core' or 'full'.\n");
          process.exitCode = 2;
          return;
        }
        process.exitCode = await updateCommand({ ...options, profile });
      },
    );

  program
    .command("sync")
    .description("Validate, then commit and push the vault")
    .argument("[topic]", "short topic for the commit message")
    .option("--dry-run", "validate and show pending changes without committing")
    .action(async (topic: string | undefined, options: { dryRun?: boolean }) => {
      process.exitCode = await syncCommand({ topic, dryRun: options.dryRun });
    });

  await program.parseAsync(process.argv);

  // Machine-readable output must stay clean, so the notice is skipped for --json.
  if (!process.argv.includes("--json")) {
    const notice = await updateNotice();
    if (notice) process.stderr.write(`\n${notice}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
