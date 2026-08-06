#!/usr/bin/env node
import { Command } from "commander";
import { addProjectCommand } from "./commands/add.js";
import { agentsCommand } from "./commands/agents.js";
import { doctorCommand } from "./commands/doctor.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import { skillsCommand } from "./commands/skills.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import type { ImportSourceId } from "./importers/index.js";
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
    .option("--name <name>", "vault name (skips the question)")
    .option("--full-name <text>", "what the vault name stands for")
    .option("--tagline <text>", "one-line description")
    .option("--naming <style>", "system note naming: branded or generic")
    .option("--profile <profile>", "system layer depth: core or full")
    .option("--operator <name>", "operator name (skips the question)")
    .option("--role <text>", "operator working identity")
    .option("--aliases <list>", "comma-separated operator aliases")
    .option("--projects <list>", "comma-separated project names; skips the import step")
    .option("--no-import", "skip the AI-history import step")
    .option("--git", "initialize a Git repository without asking")
    .option("--no-git", "skip Git initialization without asking")
    .option("--defaults", "answer every remaining question with its default (needs --name)")
    .option("--dry-run", "show the file tree that would be created, write nothing")
    .action(
      async (
        target: string | undefined,
        options: {
          lang?: string;
          yes?: boolean;
          ai?: string | boolean;
          name?: string;
          fullName?: string;
          tagline?: string;
          naming?: string;
          profile?: string;
          operator?: string;
          role?: string;
          aliases?: string;
          projects?: string;
          import?: boolean;
          git?: boolean;
          defaults?: boolean;
          dryRun?: boolean;
        },
      ) => {
        const locale = options.lang === "tr" || options.lang === "en" ? options.lang : undefined;
        const naming =
          options.naming === "branded" || options.naming === "generic" ? options.naming : undefined;
        if (options.naming && !naming) {
          process.stderr.write("--naming must be 'branded' or 'generic'.\n");
          process.exitCode = 2;
          return;
        }
        const profile =
          options.profile === "core" || options.profile === "full" ? options.profile : undefined;
        if (options.profile && !profile) {
          process.stderr.write("--profile must be 'core' or 'full'.\n");
          process.exitCode = 2;
          return;
        }
        process.exitCode = await initCommand({
          target,
          locale,
          yes: options.yes,
          ai: options.ai,
          name: options.name,
          fullName: options.fullName,
          tagline: options.tagline,
          naming,
          profile,
          operator: options.operator,
          role: options.role,
          aliases: options.aliases,
          projects: options.projects,
          import: options.import,
          git: options.git,
          defaults: options.defaults,
          dryRun: options.dryRun,
        });
      },
    );

  program
    .command("status")
    .description("One-screen vault health: projects, notes, doctor result, git state")
    .option("--json", "print the summary as JSON")
    .action(async (options: { json?: boolean }) => {
      process.exitCode = await statusCommand(options);
    });

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
          options.profile === "core" || options.profile === "full" ? options.profile : undefined;
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
