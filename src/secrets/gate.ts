import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { git } from "../util/git.js";
import { toPosix } from "../util/paths.js";
import { ALLOW_FILE, isAllowed, readAllow, type AllowList } from "./allow.js";
import { scanText, type SecretFinding } from "./detector.js";

export interface GateResult {
  /** Findings no `.vulcanus-allow` entry accepts. */
  findings: SecretFinding[];
  /** Unusable `.vulcanus-allow` lines; an entry without a reason accepts nothing. */
  allowErrors: AllowList["errors"];
  allowed: number;
  /** Files read; binary files are not read. */
  scanned: number;
}

/** Git quotes nothing with -z, so a path is only split on NUL. */
const split = (out: string): string[] => out.split("\0").filter(Boolean);

/** Files git would commit from the vault: tracked, plus untracked that are not ignored. */
export async function worktreeFiles(vaultRoot: string): Promise<string[]> {
  const out = await git(vaultRoot, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  return [...new Set(split(out))];
}

/** Staged files (added, copied, modified, renamed) under the vault, paths relative to it. */
export async function stagedFiles(vaultRoot: string): Promise<string[]> {
  const out = await git(vaultRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--relative",
    "--diff-filter=ACMR",
  ]);
  return split(out);
}

type Reader = (file: string) => Promise<string | null>;

const fromDisk =
  (vaultRoot: string): Reader =>
  (file) =>
    readFile(resolve(vaultRoot, file), "utf8").catch(() => null);

/** The staged version, so a secret removed from the working tree but still in the index is caught. */
const fromIndex =
  (vaultRoot: string): Reader =>
  (file) =>
    git(vaultRoot, ["show", `:./${file}`]).catch(() => null);

async function scan(vaultRoot: string, files: string[], read: Reader): Promise<GateResult> {
  const allow = await readAllow(vaultRoot);
  const result: GateResult = {
    findings: [],
    allowErrors: allow?.errors ?? [],
    allowed: 0,
    scanned: 0,
  };
  for (const file of files) {
    const path = toPosix(file);
    if (path === ALLOW_FILE) continue;
    const text = await read(file);
    if (text === null || text.includes("\0")) continue;
    result.scanned += 1;
    for (const hit of scanText(text, path)) {
      if (isAllowed(allow, hit)) result.allowed += 1;
      else result.findings.push(hit);
    }
  }
  return result;
}

export async function scanWorktree(vaultRoot: string): Promise<GateResult> {
  return scan(vaultRoot, await worktreeFiles(vaultRoot), fromDisk(vaultRoot));
}

export async function scanStaged(vaultRoot: string): Promise<GateResult> {
  return scan(vaultRoot, await stagedFiles(vaultRoot), fromIndex(vaultRoot));
}

export const gateFailed = (result: GateResult): boolean =>
  result.findings.length > 0 || result.allowErrors.length > 0;

/** One line per problem: `file:line kind fingerprint`; never the value. */
export function gateLines(result: GateResult): string[] {
  return [
    ...result.findings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.fingerprint}`),
    ...result.allowErrors.map((e) => `${ALLOW_FILE}:${e.line} ${e.message}`),
  ];
}
