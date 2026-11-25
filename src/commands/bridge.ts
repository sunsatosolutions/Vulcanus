import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EXIT, reportProblem } from "../errors.js";
import { applyBridge, bridgeRoot, planBridge, type BridgeEntry } from "../instructions/bridge.js";
import { SOURCE_FILE } from "../instructions/targets.js";
import * as p from "../ui.js";

export interface BridgeOptions {
  cwd?: string;
  /** Write the files; without it the command only shows what would change. */
  write?: boolean;
  json?: boolean;
}

const MAX_DIFF_LINES = 20;

/** Lines that differ, `-` for what goes and `+` for what arrives, capped so a copied file stays readable. */
function diffLines(entry: BridgeEntry): string[] {
  const before = (entry.before ?? "").split("\n");
  const after = (entry.after ?? "").split("\n");
  const gone = new Set(before);
  const kept = new Set(after);
  const lines = [
    ...before.filter((line) => !kept.has(line)).map((line) => `    - ${line}`),
    ...after.filter((line) => !gone.has(line)).map((line) => `    + ${line}`),
  ];
  return lines.length > MAX_DIFF_LINES
    ? [...lines.slice(0, MAX_DIFF_LINES), `    … ${lines.length - MAX_DIFF_LINES} more lines`]
    : lines;
}

export async function bridgeCommand(options: BridgeOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const root = bridgeRoot(start);

  if (!existsSync(resolve(root, SOURCE_FILE))) {
    return reportProblem({
      what: `No ${SOURCE_FILE} to bridge from.`,
      why: `Looked in ${root}; bridge copies one instruction file to the others and has none to read.`,
      fix: `Create ${SOURCE_FILE} there, then run vulcanus bridge again.`,
    });
  }

  const entries = await planBridge(root);
  const pending = entries.filter((entry) => entry.action === "create" || entry.action === "update");
  const written = options.write ? await applyBridge(root, entries) : [];

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          write: Boolean(options.write),
          pending: pending.length,
          written,
          files: entries.map(({ path, action }) => ({ path, action })),
        },
        null,
        2,
      )}\n`,
    );
    return options.write || pending.length === 0 ? EXIT.ok : EXIT.failed;
  }

  p.intro(`bridge — ${SOURCE_FILE}`);
  for (const entry of entries) {
    if (entry.action === "unchanged") {
      p.log.success(`${entry.path}: up to date`);
    } else if (entry.action === "vault-managed") {
      p.log.info(`${entry.path}: the vault already generates a file for this tool`);
    } else if (entry.action === "hand-written") {
      p.log.warn(`${entry.path}: written by hand, left untouched (no Vulcanus marker)`);
    } else {
      const verb = entry.action === "create" ? "create" : "update";
      const done = options.write ? (verb === "create" ? "created" : "updated") : `would ${verb}`;
      p.log.message(`${entry.path}: ${done}\n${diffLines(entry).join("\n")}`);
    }
  }

  if (options.write) {
    p.outro(written.length ? `Wrote ${written.length} file(s).` : "Nothing to write.");
    return EXIT.ok;
  }
  p.outro(pending.length ? "Nothing was written; run with --write to apply." : "No changes.");
  return pending.length ? EXIT.failed : EXIT.ok;
}
