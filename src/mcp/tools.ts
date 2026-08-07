/**
 * The vault operations `vulcanus serve` exposes over MCP, kept free of any
 * transport so they can be tested (and reused) as plain functions.
 *
 * The tool surface mirrors how the vault is meant to be read: route a task to
 * one project (`recall`), go deeper only when needed (`search`), and write
 * confirmed outcomes back (`append_decision`) so the next agent starts warmer.
 */
import { existsSync } from "node:fs";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findStaleCapsules } from "../commands/status.js";
import { buildPlan, type ProjectPlan, type VaultPlan } from "../manifest/derive.js";
import { readManifest } from "../manifest/io.js";
import type { VaultManifest } from "../manifest/schema.js";

export interface VaultHandle {
  vaultRoot: string;
  manifest: VaultManifest;
  plan: VaultPlan;
}

export async function openVault(vaultRoot: string): Promise<VaultHandle> {
  const manifest = await readManifest(vaultRoot);
  return { vaultRoot, manifest, plan: buildPlan(manifest) };
}

/** Match a project by id, name, or recall trigger, case-insensitively. */
export function matchProject(plan: VaultPlan, query: string): ProjectPlan | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;

  const byIdentity = plan.allProjects.find(
    (entry) =>
      entry.project.id.toLowerCase() === needle || entry.project.name.toLowerCase() === needle,
  );
  if (byIdentity) return byIdentity;

  const byTrigger = plan.allProjects.find((entry) =>
    entry.project.triggers.some((trigger) => trigger.toLowerCase() === needle),
  );
  if (byTrigger) return byTrigger;

  // Last resort: the query mentions the project or one of its triggers.
  return plan.allProjects.find(
    (entry) =>
      needle.includes(entry.project.name.toLowerCase()) ||
      entry.project.triggers.some(
        (trigger) => trigger.trim() && needle.includes(trigger.toLowerCase()),
      ),
  );
}

export interface RecallResult {
  project: string;
  summary: string;
  status: string;
  capsule: { name: string; path: string; content: string };
  /** Deeper notes in the order the vault protocol says to read them. */
  readNext: Array<{ name: string; path: string }>;
  /**
   * Set when the capsule is older than the notes it summarizes. An agent that
   * recalls a stale capsule would otherwise answer confidently from a summary
   * that no longer matches the decisions underneath it.
   */
  staleWarning?: string;
}

/**
 * The token-economy entry point: one capsule, plus where to go deeper. This is
 * the read an agent performs before touching a project.
 */
export async function recall(handle: VaultHandle, query: string): Promise<RecallResult | null> {
  const project = matchProject(handle.plan, query);
  if (!project) return null;

  const capsulePath = resolve(handle.vaultRoot, project.capsule.path);
  const content = existsSync(capsulePath) ? await readFile(capsulePath, "utf8") : "";

  const stale = (await findStaleCapsules(handle.vaultRoot, handle.plan)).find(
    (entry) => entry.project === project.project.name,
  );

  return {
    project: project.project.name,
    summary: project.project.summary,
    status: project.project.status,
    capsule: { name: project.capsule.name, path: project.capsule.path, content },
    ...(stale
      ? {
          staleWarning: `${stale.capsule} is older than ${stale.changedSince.join(", ")}. Read those before trusting the summary, and refresh the capsule once the operator confirms what changed.`,
        }
      : {}),
    readNext: [
      project.hub,
      project.decisions,
      project.rules,
      project.context,
      ...project.specialized.map((entry) => entry.note),
    ].map((note) => ({ name: note.name, path: note.path })),
  };
}

export interface SearchHit {
  path: string;
  /** 1-indexed line number of the match. */
  line: number;
  text: string;
  /** Capsules outrank hubs outrank everything else. */
  weight: number;
}

/**
 * Layer-aware text search: capsules first, hubs second, depth last, so the
 * cheapest sufficient note surfaces at the top.
 */
export async function search(handle: VaultHandle, query: string, limit = 20): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const weightOf = (path: string): number => {
    for (const project of handle.plan.allProjects) {
      if (path === project.capsule.path) return 3;
      if (path === project.hub.path) return 2;
    }
    if (path === handle.plan.recallMap.path) return 3;
    return 1;
  };

  const hits: SearchHit[] = [];
  const dirs = [handle.manifest.structure.systemDir, handle.manifest.structure.projectsDir];

  const walk = async (dir: string): Promise<void> => {
    const absolute = resolve(handle.vaultRoot, dir);
    if (!existsSync(absolute)) return;
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const lines = (await readFile(resolve(absolute, entry.name), "utf8")).split("\n");
        lines.forEach((text, index) => {
          if (text.toLowerCase().includes(needle)) {
            hits.push({
              path: relative,
              line: index + 1,
              text: text.trim(),
              weight: weightOf(relative),
            });
          }
        });
      }
    }
  };
  for (const dir of dirs) await walk(dir);

  hits.sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path) || a.line - b.line);
  return hits.slice(0, limit);
}

export interface AppendDecisionResult {
  project: string;
  path: string;
}

/**
 * Record a confirmed decision at the bottom of the project's Decisions note,
 * in the same Decision/Details shape the seeds use.
 */
export async function appendDecision(
  handle: VaultHandle,
  projectQuery: string,
  title: string,
  decision: string,
  details?: string,
): Promise<AppendDecisionResult | null> {
  const project = matchProject(handle.plan, projectQuery);
  if (!project) return null;

  const path = resolve(handle.vaultRoot, project.decisions.path);
  if (!existsSync(path)) return null;

  const section = [
    "",
    `## ${title.trim()}`,
    "",
    "### Decision",
    "",
    decision.trim(),
    ...(details?.trim() ? ["", "### Details", "", details.trim()] : []),
    "",
  ].join("\n");

  await appendFile(path, section, "utf8");
  return { project: project.project.name, path: project.decisions.path };
}

export interface SectionUpdateResult {
  project: string;
  path: string;
  section: string;
  /** The heading existed and was replaced, rather than appended. */
  replaced: boolean;
}

/**
 * Replace one `## Section` in a note, keeping every other section untouched.
 * Whole-file rewrites are what let an agent quietly drop memory it did not
 * think was important, so writes are always scoped to a named section.
 */
export function replaceSection(content: string, heading: string, body: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
  if (!pattern.test(content)) return null;
  return content.replace(pattern, `## ${heading}\n\n${body.trim()}\n\n`);
}

/** The capsule sections an agent may rewrite, in the order the note lists them. */
export const CAPSULE_SECTIONS = [
  "Identity",
  "Current Scope",
  "Must Remember",
  "Do Not Assume",
  "Needs Confirmation",
] as const;

export type CapsuleSection = (typeof CAPSULE_SECTIONS)[number];

/**
 * Refresh one section of a project's Capsule. `Read Next` is deliberately not
 * writable: it is the routing the generator owns, and an agent editing it would
 * break the link graph doctor validates.
 */
export async function updateCapsule(
  handle: VaultHandle,
  projectQuery: string,
  section: CapsuleSection,
  body: string,
): Promise<SectionUpdateResult | null> {
  const project = matchProject(handle.plan, projectQuery);
  if (!project) return null;

  const path = resolve(handle.vaultRoot, project.capsule.path);
  if (!existsSync(path)) return null;

  const current = await readFile(path, "utf8");
  const updated = replaceSection(current, section, body);
  if (updated === null) {
    // A capsule from an older generator may not carry every section yet.
    const appended = `${current.trimEnd()}\n\n## ${section}\n\n${body.trim()}\n`;
    await writeFile(path, appended, "utf8");
    return {
      project: project.project.name,
      path: project.capsule.path,
      section,
      replaced: false,
    };
  }

  await writeFile(path, updated, "utf8");
  return { project: project.project.name, path: project.capsule.path, section, replaced: true };
}

export interface AppendRuleResult {
  project: string;
  path: string;
  rule: string;
}

/**
 * Add a rule to a project's Rules note as its own `## <name> Rule` section, in
 * the same shape the generated rules use.
 */
export async function appendRule(
  handle: VaultHandle,
  projectQuery: string,
  name: string,
  rule: string,
): Promise<AppendRuleResult | null> {
  const project = matchProject(handle.plan, projectQuery);
  if (!project) return null;

  const path = resolve(handle.vaultRoot, project.rules.path);
  if (!existsSync(path)) return null;

  const heading = /rule$/i.test(name.trim()) ? name.trim() : `${name.trim()} Rule`;
  await appendFile(path, `\n## ${heading}\n\n${rule.trim()}\n`, "utf8");
  return { project: project.project.name, path: project.rules.path, rule: heading };
}

export interface ProjectListing {
  name: string;
  id: string;
  status: string;
  summary: string;
  triggers: string[];
  parent: string | null;
  capsule: string;
}

/** The routing table: everything an agent needs to pick the right recall. */
export function listProjects(handle: VaultHandle): ProjectListing[] {
  return handle.plan.allProjects.map((entry) => ({
    name: entry.project.name,
    id: entry.project.id,
    status: entry.project.status,
    summary: entry.project.summary,
    triggers: entry.project.triggers,
    parent: entry.ancestors.at(-1)?.name ?? null,
    capsule: entry.capsule.path,
  }));
}
