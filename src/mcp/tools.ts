/**
 * The vault operations `vulcanus serve` exposes over MCP, kept free of any
 * transport so they can be tested (and reused) as plain functions.
 *
 * The tool surface mirrors how the vault is meant to be read: route a task to
 * one project (`recall`), go deeper only when needed (`search`), and write
 * confirmed outcomes back (`append_decision`) so the next agent starts warmer.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findStaleCapsules } from "../commands/status.js";
import { buildPlan, type ProjectPlan, type VaultPlan } from "../manifest/derive.js";
import { readManifest } from "../manifest/io.js";
import type { VaultManifest } from "../manifest/schema.js";
import {
  findSection,
  headingKey,
  headingLink,
  insertFields,
  parseSections,
  sectionAt,
  sectionState,
  today,
  type LifecycleState,
} from "../memory/lifecycle.js";

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
  /** What the project is, when the vault records it. */
  kind?: string;
  visibility?: string;
  /**
   * Set when the project is marked private. Stated as an instruction rather
   * than a field an agent has to interpret, because the cost of missing it is
   * a private project named in something public.
   */
  visibilityWarning?: string;
  capsule: { name: string; path: string; content: string };
  /** Deeper notes in the order the vault protocol says to read them. */
  readNext: Array<{ name: string; path: string }>;
  /**
   * Set when the capsule is older than the notes it summarizes. An agent that
   * recalls a stale capsule would otherwise answer confidently from a summary
   * that no longer matches the decisions underneath it.
   */
  staleWarning?: string;
  /**
   * Decisions and rules that are no longer true. They stay in the notes as
   * history; listing them here lets an agent skip them without reading the
   * whole note to find out.
   */
  lifecycle?: {
    superseded: Array<{ heading: string; path: string; replacedBy: string[] }>;
    expired: Array<{ heading: string; path: string; validUntil: string }>;
  };
}

async function deadMemory(
  handle: VaultHandle,
  project: ProjectPlan,
): Promise<RecallResult["lifecycle"] | undefined> {
  const superseded: NonNullable<RecallResult["lifecycle"]>["superseded"] = [];
  const expired: NonNullable<RecallResult["lifecycle"]>["expired"] = [];
  const on = today();
  for (const note of [project.decisions, project.rules]) {
    const path = resolve(handle.vaultRoot, note.path);
    if (!existsSync(path)) continue;
    for (const section of parseSections(note.path, await readFile(path, "utf8"))) {
      const state = sectionState(section, on);
      if (state === "superseded") {
        superseded.push({
          heading: section.heading,
          path: note.path,
          replacedBy: section.supersededBy.map((link) => link.raw),
        });
      } else if (state === "expired") {
        expired.push({
          heading: section.heading,
          path: note.path,
          validUntil: section.validUntil!,
        });
      }
    }
  }
  return superseded.length || expired.length ? { superseded, expired } : undefined;
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
  const lifecycle = await deadMemory(handle, project);

  return {
    project: project.project.name,
    summary: project.project.summary,
    status: project.project.status,
    ...(project.project.kind ? { kind: project.project.kind } : {}),
    ...(project.project.visibility ? { visibility: project.project.visibility } : {}),
    ...(project.project.visibility === "private"
      ? {
          visibilityWarning: `${project.project.name} is marked private. Do not name it, quote it, or describe its work outside this vault — not in public repositories, commit messages, issues, or anything shared with someone who is not the operator.`,
        }
      : {}),
    capsule: { name: project.capsule.name, path: project.capsule.path, content },
    ...(stale
      ? {
          staleWarning: `${stale.capsule} is older than ${stale.changedSince.join(", ")}. Read those before trusting the summary, and refresh the capsule once the operator confirms what changed.`,
        }
      : {}),
    ...(lifecycle ? { lifecycle } : {}),
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
  /**
   * Set when the hit sits inside a superseded or expired section. Such hits
   * still appear — "why did we stop doing X" is a fair question — but below
   * every live hit.
   */
  state?: Exclude<LifecycleState, "live">;
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
  const on = today();
  const dirs = [handle.manifest.structure.systemDir, handle.manifest.structure.projectsDir];

  const walk = async (dir: string): Promise<void> => {
    const absolute = resolve(handle.vaultRoot, dir);
    if (!existsSync(absolute)) return;
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const content = await readFile(resolve(absolute, entry.name), "utf8");
        const sections = parseSections(relative, content);
        content.split("\n").forEach((text, index) => {
          if (text.toLowerCase().includes(needle)) {
            const section = sectionAt(sections, index + 1);
            const state = section ? sectionState(section, on) : "live";
            hits.push({
              path: relative,
              line: index + 1,
              text: text.trim(),
              weight: weightOf(relative),
              ...(state !== "live" ? { state } : {}),
            });
          }
        });
      }
    }
  };
  for (const dir of dirs) await walk(dir);

  const dead = (hit: SearchHit) => (hit.state ? 1 : 0);
  hits.sort(
    (a, b) =>
      dead(a) - dead(b) || b.weight - a.weight || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return hits.slice(0, limit);
}

export interface AppendDecisionResult {
  project: string;
  path: string;
  /** Heading written for the new decision. */
  heading: string;
  /** The heading this decision replaced, when `supersedes` was given. */
  superseded?: string;
}

/** A supersession that cannot be recorded; nothing was written. */
export class LifecycleTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleTargetError";
  }
}

export interface MemoryWriteOptions {
  /** Heading of an existing section in the same note that this one replaces. */
  supersedes?: string;
  /** Provenance written as `source::`, e.g. "import · codex · 2026-09-14". */
  source?: string;
  /** Date recorded as `superseded-on::`; defaults to today. */
  on?: string;
}

/**
 * Append a section to a project's Decisions or Rules note and, when it
 * replaces an earlier one, mark both sides. The old section gains
 * `superseded-by::`/`superseded-on::` under its heading and is otherwise left
 * exactly as it was. Every check runs before the first write, so a bad target
 * cannot leave a half-linked pair.
 */
async function appendSection(
  notePath: string,
  noteName: string,
  heading: string,
  body: string[],
  options: MemoryWriteOptions,
): Promise<{ superseded?: string }> {
  const current = await readFile(notePath, "utf8");
  const fields: string[] = [];
  let next = current;
  let superseded: string | undefined;

  if (options.supersedes?.trim()) {
    const sections = parseSections("", current);
    const old = findSection(sections, options.supersedes);
    if (!old) {
      throw new LifecycleTargetError(
        `No section "${options.supersedes}" in ${noteName}; nothing was written. Known: ${sections
          .map((section) => `"${section.heading}"`)
          .join(", ")}`,
      );
    }
    if (old.supersededBy.length) {
      throw new LifecycleTargetError(
        `"${old.heading}" is already superseded by ${old.supersededBy.map((link) => link.raw).join(", ")}; supersede that one instead. Nothing was written.`,
      );
    }
    if (findSection(sections, heading) || headingKey(heading) === headingKey(old.heading)) {
      throw new LifecycleTargetError(
        `${noteName} already has a section "${heading}"; give the new one a distinct title so the link stays unambiguous. Nothing was written.`,
      );
    }
    const patched = insertFields(current, old.heading, [
      `superseded-by:: ${headingLink(noteName, heading)}`,
      `superseded-on:: ${options.on ?? today()}`,
    ]);
    if (patched === null) throw new LifecycleTargetError(`Could not mark "${old.heading}".`);
    next = patched;
    superseded = old.heading;
    fields.push(`supersedes:: ${headingLink(noteName, old.heading)}`);
  }
  if (options.source?.trim()) fields.push(`source:: ${options.source.trim()}`);

  const section = [
    "",
    `## ${heading}`,
    "",
    ...(fields.length ? [...fields, ""] : []),
    ...body,
    "",
  ].join("\n");
  await writeFile(notePath, `${next.replace(/\n*$/, "\n")}${section}`, "utf8");
  return superseded ? { superseded } : {};
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
  options: MemoryWriteOptions = {},
): Promise<AppendDecisionResult | null> {
  const project = matchProject(handle.plan, projectQuery);
  if (!project) return null;

  const path = resolve(handle.vaultRoot, project.decisions.path);
  if (!existsSync(path)) return null;

  const heading = title.trim();
  const body = [
    "### Decision",
    "",
    decision.trim(),
    ...(details?.trim() ? ["", "### Details", "", details.trim()] : []),
  ];
  const written = await appendSection(path, project.decisions.name, heading, body, options);
  return {
    project: project.project.name,
    path: project.decisions.path,
    heading,
    ...written,
  };
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
  /** The rule heading this one replaced, when `supersedes` was given. */
  superseded?: string;
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
  options: MemoryWriteOptions = {},
): Promise<AppendRuleResult | null> {
  const project = matchProject(handle.plan, projectQuery);
  if (!project) return null;

  const path = resolve(handle.vaultRoot, project.rules.path);
  if (!existsSync(path)) return null;

  const heading = /rule$/i.test(name.trim()) ? name.trim() : `${name.trim()} Rule`;
  const written = await appendSection(path, project.rules.name, heading, [rule.trim()], options);
  return { project: project.project.name, path: project.rules.path, rule: heading, ...written };
}

export interface ProjectListing {
  name: string;
  id: string;
  status: string;
  summary: string;
  triggers: string[];
  parent: string | null;
  capsule: string;
  kind?: string;
  /** Present only when recorded; `private` means do not reveal this project. */
  visibility?: string;
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
    ...(entry.project.kind ? { kind: entry.project.kind } : {}),
    ...(entry.project.visibility ? { visibility: entry.project.visibility } : {}),
  }));
}
