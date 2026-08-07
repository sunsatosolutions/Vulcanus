import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hubExpectations, type VaultPlan } from "../manifest/derive.js";
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

/** Where each kind of hub lists what it owns. */
function sectionFor(plan: VaultPlan, path: string): string {
  if (path === plan.index.path) return "## Main Hubs";
  if (path === plan.systemHub.path) return "## System Notes";
  if (plan.groups.some((group) => group.hub.path === path)) return "## Projects";
  return "## Sub-Projects";
}

export async function wireHubs(vaultRoot: string, plan: VaultPlan): Promise<string[]> {
  const patched: string[] = [];

  for (const [path, expected] of hubExpectations(plan)) {
    const absolute = resolve(vaultRoot, path);
    if (!existsSync(absolute)) continue;

    let content = await readFile(absolute, "utf8");
    const present = new Set(wikiTargets(content));
    const missing = [...expected].filter((name) => !present.has(name));
    if (missing.length === 0) continue;

    const heading = sectionFor(plan, path);
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
