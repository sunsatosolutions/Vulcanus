#!/usr/bin/env node
import { Command } from "commander";
import { addProjectCommand } from "./commands/add.js";
import { agentsCommand } from "./commands/agents.js";
import { completionCommand, SHELLS } from "./commands/completion.js";
import { doctorCommand } from "./commands/doctor.js";
import { installHooksCommand, uninstallHooksCommand } from "./commands/hooks.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import {
  archiveProjectCommand,
  removeProjectCommand,
  renameProjectCommand,
} from "./commands/project.js";
import { serveCommand } from "./commands/serve.js";
import { skillsCommand } from "./commands/skills.js";
import { statsCommand } from "./commands/stats.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import type { ImportSourceId } from "./importers/index.js";
import { badChoiceProblem, CliError, EXIT, formatProblem, reportProblem } from "./errors.js";
import { setLogLevel } from "./ui.js";
import { updateNotice } from "./update-check.js";
import { CLI_VERSION } from "./version.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("vulcanus")
    .description("Scaffold and maintain an AI-readable second-brain vault.")
    .version(CLI_VERSION)
    .option("--verbose", "print the per-file detail commands normally summarize")
    .option("-q, --quiet", "print only errors; exit codes still carry the result")
    .addHelpText(
      "after",
      [
        "",
        "Exit codes:",
        "  0    the command did what it said",
        "  1    the vault or the operation failed validation",
        "  2    the command was used wrongly (no vault, bad flag)",
        "  130  cancelled at a prompt",
      ].join("\n"),
    );

  // Global volume is resolved once, before any command body runs.
  program.hook("preAction", (_program, action) => {
    const global = program.opts<{ verbose?: boolean; quiet?: boolean }>();
    const local = action.opts<{ json?: boolean }>();
    // Machine-readable output owns stdout: spinners and notes would corrupt it.
    if (global.quiet || local.json) setLogLevel("quiet");
    else if (global.verbose) setLogLevel("verbose");
  });

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
          process.exitCode = reportProblem(
            badChoiceProblem("--naming", options.naming, ["branded", "generic"]),
          );
          return;
        }
        const profile =
          options.profile === "core" || options.profile === "full" ? options.profile : undefined;
        if (options.profile && !profile) {
          process.exitCode = reportProblem(
            badChoiceProblem("--profile", options.profile, ["core", "full"]),
          );
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
    .command("stats")
    .description("Token budget: what a cold-start agent reads, and what recall saves")
    .option("--json", "print the report as JSON")
    .action(async (options: { json?: boolean }) => {
      process.exitCode = await statsCommand(options);
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

  const projectCmd = program
    .command("project")
    .description("Manage existing projects: remove, rename, archive");
  projectCmd
    .command("remove")
    .description("Remove a project from the graph; its notes move to _archive/")
    .argument("<name>", "project name or id")
    .action(async (name: string) => {
      process.exitCode = await removeProjectCommand(name);
    });
  projectCmd
    .command("rename")
    .description("Rename a project everywhere: folder, notes, and links")
    .argument("<old>", "current project name or id")
    .argument("<new>", "new project name")
    .action(async (oldName: string, newName: string) => {
      process.exitCode = await renameProjectCommand(oldName, newName);
    });
  projectCmd
    .command("archive")
    .description("Mark a project archived without touching its notes")
    .argument("<name>", "project name or id")
    .option("--restore", "set the project active again")
    .action(async (name: string, options: { restore?: boolean }) => {
      process.exitCode = await archiveProjectCommand(name, options);
    });

  program
    .command("import")
    .description("Propose projects from an AI conversation export")
    .option(
      "-s, --source <source>",
      "chatgpt | claude | claude-code | codex | gemini | cursor | markdown",
    )
    .option("-p, --path <path>", "path to the export or session directory")
    .option("--ai [cli]", "let a locally installed AI CLI write the project notes")
    .option("--json", "analyze and print the candidates as JSON; writes nothing")
    .action(
      async (options: {
        source?: string;
        path?: string;
        ai?: string | boolean;
        json?: boolean;
      }) => {
        process.exitCode = await importCommand({
          source: options.source as ImportSourceId | undefined,
          path: options.path,
          ai: options.ai,
          json: options.json,
        });
      },
    );

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
    .command("serve")
    .description("Serve the vault to MCP clients over stdio: recall, search, append_decision, …")
    .option("--cwd <dir>", "vault directory to serve, for clients started elsewhere")
    .action(async (options: { cwd?: string }) => {
      process.exitCode = await serveCommand(options);
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
          process.exitCode = reportProblem(
            badChoiceProblem("--profile", options.profile, ["core", "full"]),
          );
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
    .option("--json", "print the result as JSON")
    .option("--watch", "keep running: regenerate and revalidate on every edit, never commit")
    .action(
      async (
        topic: string | undefined,
        options: { dryRun?: boolean; json?: boolean; watch?: boolean },
      ) => {
        process.exitCode = await syncCommand({
          topic,
          dryRun: options.dryRun,
          json: options.json,
          watch: options.watch,
        });
      },
    );

  const hooks = program
    .command("hooks")
    .description("Git hooks that keep a broken memory graph out of history");
  hooks
    .command("install")
    .description("Install a pre-commit hook that runs `vulcanus doctor`")
    .option("--force", "replace a pre-commit hook this CLI did not write")
    .action(async (options: { force?: boolean }) => {
      process.exitCode = await installHooksCommand(options);
    });
  hooks
    .command("uninstall")
    .description("Remove the pre-commit hook")
    .action(async () => {
      process.exitCode = await uninstallHooksCommand();
    });

  program
    .command("completion")
    .description(`Print a shell completion script: ${SHELLS.join(" | ")}`)
    .argument("[shell]", SHELLS.join(" | "))
    .action((shell: string | undefined) => {
      process.exitCode = completionCommand(shell);
    });

  await program.parseAsync(process.argv);

  // Machine-readable output must stay clean, so the notice is skipped for --json.
  if (!process.argv.includes("--json")) {
    const notice = await updateNotice();
    if (notice) process.stderr.write(`\n${notice}\n`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(formatProblem(error.problem));
    process.exitCode = error.exitCode;
    return;
  }
  // An unexpected throw is a bug in the CLI, not operator error: say so, and
  // point at the one place that can act on it.
  process.stderr.write(
    formatProblem({
      what: error instanceof Error ? error.message : String(error),
      why: "Vulcanus did not expect this failure.",
      fix: "Report it: https://github.com/sunsatosolutions/Vulcanus/issues",
    }),
  );
  process.exitCode = EXIT.failed;
});
