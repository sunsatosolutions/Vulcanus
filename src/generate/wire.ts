import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hubExpectations, hubNavigationSections, type VaultPlan } from "../manifest/derive.js";
import { wikiTargets } from "../util/markdown.js";
import { ensureBulletUnderHeading } from "./patch.js";

/**
 * Add the links a hub is missing, without rewriting the hub.
 *
 * Hubs are seed files: the operator writes in them, and regenerating one
 * deletes what they wrote. But a hub still has to link to everything it owns,
 * or the graph develops isolated notes — so when the manifest gains a project
 * or the system layer deepens, the missing bullets are inserted surgically and
 * everything else is left exactly as it was.
 */

export async function wireHubs(vaultRoot: string, plan: VaultPlan): Promise<string[]> {
  const patched: string[] = [];
  // One source for where a hub lists what it owns, shared with the doctor so
  // the check and the repair cannot drift apart.
  const sections = hubNavigationSections(plan);

  for (const [path, expected] of hubExpectations(plan)) {
    const absolute = resolve(vaultRoot, path);
    if (!existsSync(absolute)) continue;

    let content = await readFile(absolute, "utf8");
    const present = new Set(wikiTargets(content));
    const missing = [...expected].filter((name) => !present.has(name));
    if (missing.length === 0) continue;

    const heading = sections.get(path)?.[0] ?? "## Sub-Projects";
    let changed = false;
    for (const name of missing) {
      const result = ensureBulletUnderHeading(content, heading, `- [[${name}]]`);
      content = result.content;
      changed = changed || result.changed;
    }

    if (changed) {
      await writeFile(absolute, content, "utf8");
      patched.push(path);
    }
  }

  return patched;
}
