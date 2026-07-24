import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildPlan, type VaultPlan } from "../manifest/derive.js";
import type { VaultManifest } from "../manifest/schema.js";
import { generateAgentFiles } from "./agents.js";
import { generateProjectNotes } from "./project.js";
import { generateRootFiles } from "./root.js";
import { generateSkillFiles } from "./skills.js";
import { generateSystemNotes } from "./system.js";
import type { GeneratedFile } from "./types.js";

export type { GeneratedFile } from "./types.js";

export function generateFiles(manifest: VaultManifest): { plan: VaultPlan; files: GeneratedFile[] } {
  const plan = buildPlan(manifest);
  const files = [
    ...generateRootFiles(plan),
    ...generateAgentFiles(plan),
    ...generateSkillFiles(plan),
    ...generateSystemNotes(plan),
    ...generateProjectNotes(plan),
  ];
  return { plan, files };
}

export type WriteAction = "created" | "updated" | "unchanged" | "skipped";

export interface WriteResult {
  path: string;
  action: WriteAction;
}

export interface WriteOptions {
  /** Rewrite `managed` files that already exist. `seed` files are still preserved. */
  repair?: boolean;
  /** Rewrite everything, including hand-edited `seed` files. */
  force?: boolean;
  /** Compute results without touching the filesystem. */
  dryRun?: boolean;
}

/**
 * Write generated files with a conservative overwrite policy: notes the operator
 * is expected to edit are never clobbered unless `force` is set.
 */
export async function writeFiles(
  vaultRoot: string,
  files: GeneratedFile[],
  options: WriteOptions = {},
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];

  for (const file of files) {
    const target = resolve(vaultRoot, file.path);
    const exists = existsSync(target);

    if (!exists) {
      if (!options.dryRun) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
      }
      results.push({ path: file.path, action: "created" });
      continue;
    }

    const mayOverwrite = options.force || (options.repair && file.kind === "managed");
    if (!mayOverwrite) {
      results.push({ path: file.path, action: "skipped" });
      continue;
    }

    const current = await readFile(target, "utf8");
    if (current === file.content) {
      results.push({ path: file.path, action: "unchanged" });
      continue;
    }

    if (!options.dryRun) await writeFile(target, file.content, "utf8");
    results.push({ path: file.path, action: "updated" });
  }

  return results;
}
