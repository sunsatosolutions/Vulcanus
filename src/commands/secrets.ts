import { noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot } from "../manifest/io.js";
import { gateFailed, gateLines, scanStaged, scanWorktree } from "../secrets/gate.js";
import * as p from "../ui.js";

export interface SecretsOptions {
  cwd?: string;
  /** Only what is staged for the next commit, read from the index. */
  staged?: boolean;
}

/** Known-pattern secret check for the pre-commit hook: `file:line kind fingerprint`, never a value. */
export async function secretsCommand(options: SecretsOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus secrets"));

  let result;
  try {
    result = await (options.staged ? scanStaged(vaultRoot) : scanWorktree(vaultRoot));
  } catch {
    return reportProblem(
      {
        what: "Could not list the vault's files.",
        why: "This vault is not a Git repository, or git failed.",
        fix: "git init",
      },
      1,
    );
  }

  if (!gateFailed(result)) {
    p.log.success(
      `${result.scanned} files checked against known patterns, ${result.findings.length} matches, ${result.allowed} allowed. Known patterns only; no match is not a guarantee.`,
    );
    return 0;
  }
  process.stderr.write(`${gateLines(result).join("\n")}\n`);
  p.log.error(
    "Secret match found. Remove it, or accept a false positive in .vulcanus-allow with a reason.",
  );
  return 1;
}
