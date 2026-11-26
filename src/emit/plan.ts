import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Problem } from "../errors.js";
import type { ProjectPlan } from "../manifest/derive.js";
import type { VaultManifest } from "../manifest/schema.js";
import { expandHome } from "../util/paths.js";
import { BEGIN, END, planFile, planRemoval, type FilePlan } from "./block.js";
import { readBlock } from "../memory/rules.js";
import { projectContent } from "./content.js";
import { TEMPLATES } from "./templates/index.js";

export interface EmitJob {
  plan: ProjectPlan;
  repo: string;
  files: FilePlan[];
}

export function repoOf(
  plan: ProjectPlan,
  vaultRoot: string,
  cwd: string,
  repo?: string,
): string | Problem {
  const { root } = plan.project;
  const dir = repo
    ? resolve(cwd, expandHome(repo))
    : typeof root === "string" && root
      ? resolve(vaultRoot, expandHome(root))
      : null;
  if (dir === null) {
    return {
      what: `Project "${plan.project.name}" has no repository folder.`,
      why: "vulcanus.json lists no `root` for it, and --repo was not given.",
      fix: [
        `vulcanus emit ${plan.project.id} --repo <dir>`,
        "or set `root` on the project in vulcanus.json",
      ],
    };
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      what: `Repository ${dir} is not a folder.`,
      why: "The agent files are written into it, and nothing is there.",
      fix: "Point --repo, or `root` in vulcanus.json, at the code repository.",
    };
  }
  return dir;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface PlanInput {
  vaultRoot: string;
  manifest: VaultManifest;
  notes: ReadonlyMap<string, string>;
  cwd: string;
  repo?: string;
  on: string;
  includePrivate: boolean;
}

/** What `emit` would do for one project: the job, or the reason it cannot be planned. */
export async function planProject(plan: ProjectPlan, input: PlanInput): Promise<EmitJob | Problem> {
  const repo = repoOf(plan, input.vaultRoot, input.cwd, input.repo);
  if (typeof repo !== "string") return repo;
  const content = projectContent({
    notes: input.notes,
    manifest: input.manifest,
    plan,
    on: input.on,
    includePrivate: input.includePrivate,
  });
  const files: FilePlan[] = [];
  if (content === null) {
    // Nothing current is left: take out what an earlier run wrote, keep the rest.
    for (const template of TEMPLATES) {
      const stale = planRemoval(template, await readOrNull(resolve(repo, template.path)));
      if (stale) files.push(stale);
    }
    return { plan, repo, files };
  }
  if (content.includes(BEGIN) || content.includes(END)) {
    return {
      what: `${plan.project.name} notes contain a vulcanus emit marker.`,
      why: "The block would end where the note text says so.",
      fix: `Remove ${BEGIN} and ${END} from the notes.`,
    };
  }
  for (const template of TEMPLATES) {
    files.push(planFile(template, await readOrNull(resolve(repo, template.path)), content));
  }
  return { plan, repo, files };
}

/** Why a file is not current, in the words `emit --check` and `doctor` use. */
export function staleReason(file: FilePlan): string {
  if (file.state === "create") return "missing";
  if (file.state === "append") return "no vulcanus block";
  if (file.state === "broken") return `damaged markers (${file.reason})`;
  return "stale";
}

/**
 * True when `emit` has been here: a template file in the repository holds a vulcanus
 * marker, whole or damaged. For a project whose notes could not be planned.
 */
export async function repoHasEmitMarker(plan: ProjectPlan, input: PlanInput): Promise<boolean> {
  const repo = repoOf(plan, input.vaultRoot, input.cwd, input.repo);
  if (typeof repo !== "string") return false;
  for (const template of TEMPLATES) {
    const text = await readOrNull(resolve(repo, template.path));
    if (text !== null && readBlock(text, BEGIN, END).kind !== "none") return true;
  }
  return false;
}
