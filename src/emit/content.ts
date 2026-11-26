import { headingVariants } from "../generate/text.js";
import type { ProjectPlan } from "../manifest/derive.js";
import type { VaultManifest } from "../manifest/schema.js";
import {
  LIFECYCLE_KEYS,
  fenceAfter,
  parseSections,
  sectionState,
  stripComments,
} from "../memory/lifecycle.js";
import { plainLinks } from "../memory/rules.js";

const LIFECYCLE_LINE = new RegExp(`^\\s*(?:${LIFECYCLE_KEYS.join("|")})::`);

export interface ContentOptions {
  /** Vault-relative path to note text, as `loadVaultNotes` returns it. */
  notes: ReadonlyMap<string, string>;
  manifest: VaultManifest;
  plan: ProjectPlan;
  /** ISO date that decides what has expired. */
  on: string;
  includePrivate: boolean;
}

/**
 * The project's Capsule and Rules sections that are still true, as Markdown;
 * null when none is. A section that is superseded or past `valid-until` is left out
 * (the same `sectionState` `doctor` uses), and so is anything that names a private
 * project, unless the operator asked for it.
 */
export function projectContent(options: ContentOptions): string | null {
  const { notes, manifest, plan, on, includePrivate } = options;
  const language = manifest.vault.language;
  const skip = new Set(headingVariants("Read Next", language));
  const hidden = includePrivate
    ? []
    : manifest.projects
        .filter((project) => project.visibility === "private" && project.id !== plan.project.id)
        .flatMap((project) => [project.name, project.id])
        .map((name) => name.toLowerCase());
  const leaks = (text: string) => hidden.some((name) => text.toLowerCase().includes(name));

  const out: string[] = [];
  for (const path of [plan.capsule.path, plan.rules.path]) {
    const text = notes.get(path);
    if (text === undefined) continue;
    const lines = stripComments(text).split("\n");
    for (const section of parseSections(path, text)) {
      if (sectionState(section, on) !== "live") continue;
      if (skip.has(`## ${section.heading}`) || leaks(section.heading)) continue;

      let fence: string | null = null;
      const body: string[] = [];
      for (const line of lines.slice(section.line, section.endLine)) {
        const step = fenceAfter(fence, line);
        fence = step.fence;
        const inCode = step.isFence || fence !== null;
        if (!inCode && LIFECYCLE_LINE.test(line)) continue;
        // Checked on the raw line: a wikilink alias would hide the target name,
        // and a code block is copied as it is.
        if (leaks(line)) {
          if (step.isFence) body.push(/^\s*(?:`{3,}|~{3,})/.exec(line)?.[0] ?? "```");
          continue;
        }
        body.push(plainLinks(line.trimEnd()));
      }
      while (body.length && body[0] === "") body.shift();
      while (body.length && body[body.length - 1] === "") body.pop();
      if (body.length === 0) continue;
      out.push(`### ${plainLinks(section.heading)}`, "", ...body, "");
    }
  }
  if (out.length === 0) return null;
  return [`## ${plan.project.name}`, "", ...out].join("\n").trimEnd();
}
