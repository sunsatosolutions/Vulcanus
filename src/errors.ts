/**
 * One shape for every failure the CLI reports: what happened, why, and what to
 * do about it. A bare "No vulcanus.json found" leaves the operator guessing at
 * all three, and the guessing is worst exactly when a command fails inside a
 * script or an agent run.
 */

/**
 * Exit codes are part of the CLI's contract — scripts and agents branch on
 * them, so they may only grow, never change meaning.
 *
 * - `0`   the command did what it said
 * - `1`   the vault or the operation failed validation (doctor findings, a
 *         refused rename, a push that did not happen)
 * - `2`   the command was used wrongly: no vault, bad flag, unknown source
 * - `130` the operator cancelled at a prompt (128 + SIGINT, the shell convention)
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  cancelled: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Problem {
  /** What happened, in one line, without blame or apology. */
  what: string;
  /** Why it happened — the state that made it fail. */
  why?: string;
  /** What to do next. Commands are listed one per line. */
  fix?: string | string[];
}

export function formatProblem(problem: Problem): string {
  const lines = [problem.what];
  if (problem.why) lines.push(`  why: ${problem.why}`);
  const fixes = problem.fix === undefined ? [] : [problem.fix].flat();
  for (const [index, fix] of fixes.entries()) {
    lines.push(index === 0 ? `  fix: ${fix}` : `       ${fix}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Report a problem on stderr and hand back the exit code to return. */
export function reportProblem(problem: Problem, code: ExitCode = EXIT.usage): ExitCode {
  process.stderr.write(formatProblem(problem));
  return code;
}

/** Thrown from deep code that cannot return an exit code itself. */
export class CliError extends Error {
  readonly problem: Problem;
  readonly exitCode: ExitCode;

  constructor(problem: Problem, exitCode: ExitCode = EXIT.usage) {
    super(problem.what);
    this.name = "CliError";
    this.problem = problem;
    this.exitCode = exitCode;
  }
}

/** The most common failure by far: the command was run outside a vault. */
export function noVaultProblem(start: string, command = "this command"): Problem {
  return {
    what: `No vault here: ${command} needs a vulcanus.json.`,
    why: `Looked in ${start} and every parent directory.`,
    fix: ["cd into your vault, or", "vulcanus init   # to create one here"],
  };
}

/** A flag that only accepts a fixed set of words. */
export function badChoiceProblem(flag: string, value: string, allowed: string[]): Problem {
  return {
    what: `${flag} does not accept "${value}".`,
    why: `Allowed values: ${allowed.join(", ")}.`,
    fix: `${flag} ${allowed[0]}`,
  };
}
