import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { isAllowed, readAllow } from "../secrets/allow.js";
import { scanText } from "../secrets/detector.js";
import { toPosix } from "../util/paths.js";
import * as p from "../ui.js";

const run = promisify(execFile);

/** Marker line: how `hooks uninstall` knows the hook is ours to remove. */
const SIGNATURE = "# installed by vulcanus hooks install";

/**
 * The hook for one vault. Git runs hooks from the repository root, which is not
 * the vault when the vault is a folder inside a larger repository, so the hook
 * moves there first.
 */
function hookScript(vaultRoot: string): string {
  const quoted = `'${toPosix(vaultRoot).replace(/'/g, "'\\''")}'`;
  return `#!/bin/sh
${SIGNATURE}
#
# Refuse a commit that would put a secret or a broken memory graph into
# history: a leaked key or a dangling wikilink is far cheaper to fix now than
# to discover months later.
#
# Bypass once with:  git commit --no-verify

cd ${quoted} || exit 1

if ! command -v vulcanus >/dev/null 2>&1; then
  echo "vulcanus not on PATH; skipping vault validation." >&2
  exit 0
fi

# Staged content matching a known secret pattern (.vulcanus-allow is honoured).
if ! vulcanus hooks scan-staged >&2; then
  echo "staged content matches a known secret pattern; commit refused." >&2
  exit 1
fi

if ! vulcanus doctor --json > /dev/null 2>&1; then
  echo "vulcanus doctor found errors; commit refused." >&2
  vulcanus doctor >&2
  exit 1
fi

# Agent files that fell behind the notes would hand agents rules that no longer hold.
if ! vulcanus emit --check --emitted-only > /dev/null 2>&1; then
  echo "agent files are out of date; commit refused. Run: vulcanus emit" >&2
  vulcanus emit --check --emitted-only >&2
  exit 1
fi
exit 0
`;
}

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

const run_ = (cwd: string, args: string[]) =>
  run("git", args, { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });

/**
 * Scan what is staged (the index, not the working tree) inside the vault for
 * known secret patterns. Prints kind, location and allow id, never the value.
 * 0 = clean, 1 = findings.
 */
export async function scanStagedCommand(options: HooksOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus hooks scan-staged"));

  let names: string[];
  try {
    const { stdout } = await run_(vaultRoot, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "--relative",
      "-z",
    ]);
    names = stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return reportProblem({
      what: "Could not read the staged changes.",
      why: `${vaultRoot} is not a Git repository.`,
      fix: "git init",
    });
  }

  const allow = await readAllow(vaultRoot);
  let found = 0;
  for (const name of names) {
    let stdout: Buffer;
    try {
      ({ stdout } = await run_(vaultRoot, ["show", `:./${name}`]));
    } catch {
      continue; // submodule/gitlink entry: no blob to read
    }
    if (stdout.includes(0)) continue; // binary
    for (const hit of scanText(stdout.toString("utf8"), toPosix(name))) {
      if (isAllowed(allow, hit)) continue;
      found += 1;
      process.stderr.write(`${hit.file}:${hit.line} ${hit.kind} (allow id ${hit.fingerprint})\n`);
    }
  }
  if (found) {
    process.stderr.write(
      `${found} staged secret${found === 1 ? "" : "s"} matching known patterns. Remove the value (and rotate the key); if it is not a secret, add a reasoned entry to .vulcanus-allow.\n`,
    );
  }
  return found ? 1 : 0;
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

  await writeFile(target, hookScript(vaultRoot), "utf8");
  // Windows ignores the mode bit; POSIX will not run the hook without it.
  await chmod(target, 0o755).catch(() => undefined);

  p.intro(`hooks — ${manifest.vault.name}`);
  p.log.success(`pre-commit hook installed at ${target}`);
  p.outro(
    "Commits now run a staged-secret scan, `vulcanus doctor` and `vulcanus emit --check --emitted-only` first. Bypass one with `git commit --no-verify`.",
  );
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
