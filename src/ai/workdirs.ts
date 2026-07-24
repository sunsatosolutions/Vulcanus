import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { readJsonl } from "../importers/jsonl.js";
import { slugify } from "../util/text.js";

/** A session file records its working directory early; stop reading once it does. */
const CWD_SCAN_LINES = 40;
/** Codex keeps every rollout forever, so only the newest ones are worth scanning. */
const MAX_CODEX_FILES = 200;

async function firstCwd(file: string, key: "cwd" | "payload"): Promise<string | undefined> {
  let lines = 0;
  for await (const entry of readJsonl(file)) {
    if (key === "cwd") {
      if (typeof entry.cwd === "string") return entry.cwd;
    } else {
      const payload = entry.payload as { cwd?: unknown } | undefined;
      if (payload && typeof payload.cwd === "string") return payload.cwd;
    }
    if (++lines >= CWD_SCAN_LINES) return undefined;
  }
  return undefined;
}

async function claudeCodeDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(root, entry.name);
    const files = (await readdir(dir).catch(() => [])).filter((file) =>
      file.toLowerCase().endsWith(".jsonl"),
    );
    for (const file of files) {
      const cwd = await firstCwd(resolve(dir, file), "cwd");
      if (cwd) {
        out.push(cwd);
        break;
      }
    }
  }

  return out;
}

async function codexRollouts(root: string): Promise<string[]> {
  const roots = [resolve(root, "sessions"), resolve(root, "archived_sessions")].filter((dir) =>
    existsSync(dir),
  );

  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) files.push(full);
    }
  };
  for (const dir of roots) await walk(dir, 0);

  // Rollout paths carry YYYY/MM/DD, so a descending sort is a recency sort.
  const newest = files.sort().reverse().slice(0, MAX_CODEX_FILES);

  const out: string[] = [];
  for (const file of newest) {
    const cwd = await firstCwd(file, "payload");
    if (cwd) out.push(cwd);
  }
  return out;
}

/**
 * Directories the operator has actually run an AI CLI in. Asking "is this the
 * one?" beats asking for a path blind, and the sessions on disk already know
 * every repository worth proposing.
 */
export async function detectSourceDirectories(home: string = homedir()): Promise<string[]> {
  const found = [
    ...(await claudeCodeDirs(resolve(home, ".claude/projects"))),
    ...(await codexRollouts(resolve(home, ".codex"))),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of found) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      if (statSync(dir).isDirectory()) out.push(dir);
    } catch {
      // The session outlived the checkout it was recorded in.
    }
  }
  return out;
}

function compact(value: string): string {
  return slugify(value).replace(/-/g, "");
}

/**
 * Rank known working directories against a project name. Only the leaf name is
 * compared, because "Kiln" is the project and `/Users/ada/code/kiln` is where it
 * happens to live on this machine.
 */
export function proposeSourceDirectories(
  projectName: string,
  directories: string[],
  limit = 3,
): string[] {
  const target = compact(projectName);
  if (!target) return [];

  const scored = directories
    .map((dir) => {
      const leaf = compact(basename(dir));
      if (!leaf) return { dir, score: 0 };
      if (leaf === target) return { dir, score: 3 };
      if (leaf.startsWith(target) || target.startsWith(leaf)) return { dir, score: 2 };
      if (leaf.includes(target) || target.includes(leaf)) return { dir, score: 1 };
      return { dir, score: 0 };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.dir.length - b.dir.length || a.dir.localeCompare(b.dir));
  return scored.slice(0, limit).map((entry) => entry.dir);
}
