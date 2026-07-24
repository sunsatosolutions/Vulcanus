import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export interface AiCli {
  id: string;
  /** Executable names probed on PATH, in order; the first hit wins. */
  commands: readonly string[];
  label: string;
  /** Arguments that open an interactive session already seeded with a prompt. */
  args: (prompt: string) => string[];
}

export interface DetectedCli extends AiCli {
  /** The name that resolved, which is not always the first candidate. */
  command: string;
  /** Absolute path the command resolved to, shown before anything is spawned. */
  path: string;
}

/**
 * The handoff needs a CLI that stays interactive, because the AI is expected to
 * ask the operator questions the codebase cannot answer. Anything that would run
 * headless and exit belongs in a different feature — so Gemini takes `-i` rather
 * than `-p`, and Cursor is left in its default agent mode rather than `--print`.
 *
 * Cursor renamed its binary from `cursor-agent` to `agent`, and both are still
 * in the wild, so both are probed. `agent` is a generic enough name that the
 * resolved path is always shown before the operator confirms the spawn.
 */
export const AI_CLIS: readonly AiCli[] = [
  { id: "claude", commands: ["claude"], label: "Claude Code", args: (prompt) => [prompt] },
  { id: "codex", commands: ["codex"], label: "Codex CLI", args: (prompt) => [prompt] },
  {
    id: "cursor-agent",
    commands: ["cursor-agent", "agent"],
    label: "Cursor Agent",
    args: (prompt) => [prompt],
  },
  { id: "gemini", commands: ["gemini"], label: "Gemini CLI", args: (prompt) => ["-i", prompt] },
];

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Windows marks executability by extension; POSIX probes the bare name. */
function suffixes(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [""];
  return (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
}

/**
 * Resolve a command the way the shell would. Shell aliases and functions are
 * invisible here on purpose: the handoff spawns the binary directly, so a name
 * that only exists inside an interactive shell would fail at spawn time.
 */
export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  executable: (path: string) => boolean = isExecutableFile,
): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes(env)) {
      const candidate = resolve(dir, `${command}${suffix}`);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

export function detectAiClis(
  env: NodeJS.ProcessEnv = process.env,
  executable: (path: string) => boolean = isExecutableFile,
): DetectedCli[] {
  const found: DetectedCli[] = [];
  for (const cli of AI_CLIS) {
    for (const command of cli.commands) {
      const path = findOnPath(command, env, executable);
      if (path) {
        found.push({ ...cli, command, path });
        break;
      }
    }
  }
  return found;
}
