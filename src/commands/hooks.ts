import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import * as p from "../ui.js";

const run = promisify(execFile);

/** Marker line: how `hooks uninstall` knows the hook is ours to remove. */
const SIGNATURE = "# installed by vulcanus hooks install";

const HOOK = `#!/bin/sh
${SIGNATURE}
#
# Refuse a commit that would put a broken memory graph into history: a dangling
# wikilink is far cheaper to fix now than to discover months later, when an
# agent silently recalls nothing.
#
# Bypass once with:  git commit --no-verify

if ! command -v vulcanus >/dev/null 2>&1; then
  echo "vulcanus not on PATH; skipping vault validation." >&2
  exit 0
fi

vulcanus doctor --json > /dev/null 2>&1 && exit 0

echo "vulcanus doctor found errors; commit refused." >&2
vulcanus doctor >&2
exit 1
`;

export interface HooksOptions {
  cwd?: string;
  force?: boolean;
}

async function hooksDir(vaultRoot: string): Promise<string | null> {
  try {
    // Honours core.hooksPath, so a vault using husky or a shared hooks
    // directory gets the hook where git will actually look for it.
    const { stdout } = await run("git", ["rev-parse", "--git-path", "hooks"], { cwd: vaultRoot });
    return resolve(vaultRoot, stdout.trim());
  } catch {
    return null;
  }
}

export async function installHooksCommand(options: HooksOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus hooks install"));

  const dir = await hooksDir(vaultRoot);
  if (!dir || !existsSync(dir)) {
    return reportProblem({
      what: "This vault is not a Git repository.",
      why: `No hooks directory under ${vaultRoot}.`,
      fix: ["git init", "vulcanus hooks install"],
    });
  }

  const manifest = await readManifest(vaultRoot);
  const target = resolve(dir, "pre-commit");

  if (existsSync(target)) {
    const existing = await readFile(target, "utf8");
    if (!existing.includes(SIGNATURE) && !options.force) {
      return reportProblem({
        what: "A pre-commit hook is already installed here.",
        why: "It was not written by Vulcanus, and overwriting it would lose whatever it does.",
        fix: [
          "Inspect it first:",
          `cat ${target}`,
          "Then either merge the check in by hand, or replace it:",
          "vulcanus hooks install --force",
        ],
      });
    }
  }

  await writeFile(target, HOOK, "utf8");
  // Windows ignores the mode bit; POSIX will not run the hook without it.
  await chmod(target, 0o755).catch(() => undefined);

  p.intro(`hooks — ${manifest.vault.name}`);
  p.log.success(`pre-commit hook installed at ${target}`);
  p.outro("Commits now run `vulcanus doctor` first. Bypass one with `git commit --no-verify`.");
  return 0;
}

export async function uninstallHooksCommand(options: HooksOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus hooks uninstall"));

  const dir = await hooksDir(vaultRoot);
  const target = dir ? resolve(dir, "pre-commit") : null;
  if (!target || !existsSync(target)) {
    p.log.info("No pre-commit hook to remove.");
    return 0;
  }

  const existing = await readFile(target, "utf8");
  if (!existing.includes(SIGNATURE)) {
    return reportProblem({
      what: "The pre-commit hook here was not installed by Vulcanus.",
      why: "Removing someone else's hook silently is not this command's call.",
      fix: `Remove it yourself if you meant to: rm ${target}`,
    });
  }

  await rm(target);
  p.log.success(`removed ${target}`);
  return 0;
}
