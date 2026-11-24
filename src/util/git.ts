import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Run git locally, without a shell. Git never gets a prompt or a pager, and
 * nothing here talks to a remote.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
  });
  return stdout;
}

/** Output of a git command, or null when it exits non-zero. */
export async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/** A full or abbreviated commit id; anything else never reaches git as an argument. */
export const COMMIT_ID = /^[0-9a-f]{7,64}$/i;

/** A pathspec that means exactly this repo-relative file, wherever git was started. */
export const literalPath = (path: string): string => `:(top,literal)${path}`;
