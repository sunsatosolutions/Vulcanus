import { slugify } from "../util/text.js";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = "vulcanus.json";

export type Language = "tr" | "en";
export type NamingStyle = "branded" | "generic";
export type VaultProfile = "core" | "full";

export interface VaultIdentity {
  /** Short display name that also prefixes system notes in `branded` mode. */
  name: string;
  /** Optional expansion, e.g. "Machine Intelligence Recall Archive". */
  fullName?: string;
  tagline?: string;
  /** Language the generated notes are written in. */
  language: Language;
  naming: NamingStyle;
  profile: VaultProfile;
}

export interface AdminIdentity {
  name: string;
  role?: string;
  /** Other words that refer to the same person inside the vault. */
  aliases: string[];
  /** Preferred conversational language for the operator. */
  language: Language;
  workingStyle: string[];
  technical: string[];
  boundaries: string[];
}

export interface StructureConfig {
  systemDir: string;
  projectsDir: string;
  importsDir: string;
  /** Generated, git-ignored state directory. */
  stateDir: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  summary?: string;
  /**
   * Navigation-only groups exist for graph traversal and must never be read as
   * an ownership or hierarchy claim between the projects it gathers.
   */
  navigationOnly: boolean;
}

export interface ProjectNode {
  id: string;
  name: string;
  /** Parent project id, or null for a top-level project. */
  parent: string | null;
  /** Group id for navigation clustering, or null. */
  group: string | null;
  status: string;
  summary: string;
  /** Recall Map trigger words that route to this project. */
  triggers: string[];
  /** Extra note kinds beyond Capsule/Hub/Context/Decisions/Rules. */
  specialized: string[];
  /** Folder name override; defaults to the project name. */
  dirName?: string;
}

export interface ImportRecord {
  source: string;
  date: string;
  conversations: number;
  candidatesAccepted: number;
  note?: string;
}

export interface VaultManifest {
  manifestVersion: number;
  generator: { name: string; version: string };
  vault: VaultIdentity;
  admin: AdminIdentity;
  structure: StructureConfig;
  groups: ProjectGroup[];
  projects: ProjectNode[];
  imports: ImportRecord[];
}

export const DEFAULT_STRUCTURE: StructureConfig = {
  systemDir: "00_System",
  projectsDir: "02_Projects",
  importsDir: "_imports",
  stateDir: ".vault-state",
};

/** Note kinds that always exist for every project. */
export const CORE_PROJECT_NOTES = ["Capsule", "Hub", "Context", "Decisions", "Rules"] as const;

/** Specialized note kinds the wizard offers; free-form values are also allowed. */
export const KNOWN_SPECIALIZED_NOTES = [
  "Architecture",
  "Flow",
  "Visual Direction",
  "Content Guidelines",
] as const;

/** System notes generated for every vault. */
export const CORE_SYSTEM_NOTES = [
  "Index",
  "Recall Map",
  "Admin Profile",
  "Context",
  "Rules",
  "Update Format",
  "Changelog",
  "Import Log",
] as const;

/** Additional system notes generated for the `full` profile. */
export const FULL_SYSTEM_NOTES = [
  "Brain OS Architecture",
  "Operating Intuition",
  "Neural Link Map",
  "Memory Confidence Model",
] as const;

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export function makeProjectId(name: string, taken: Set<string>): string {
  const base = slugify(name) || "project";
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  taken.add(id);
  return id;
}

export function validateManifest(manifest: VaultManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    warn(
      `manifest version ${manifest.manifestVersion} does not match this CLI (${MANIFEST_VERSION}); some checks may not apply`,
    );
  }
  if (!manifest.vault?.name?.trim()) error("vault.name is required");
  if (!manifest.admin?.name?.trim()) error("admin.name is required");

  const groupIds = new Set<string>();
  for (const group of manifest.groups) {
    if (groupIds.has(group.id)) error(`duplicate group id: ${group.id}`);
    groupIds.add(group.id);
  }

  const projectIds = new Set<string>();
  const projectNames = new Map<string, string>();
  for (const project of manifest.projects) {
    if (projectIds.has(project.id)) error(`duplicate project id: ${project.id}`);
    projectIds.add(project.id);

    const nameKey = project.name.trim().toLowerCase();
    const existing = projectNames.get(nameKey);
    if (existing) {
      error(
        `projects "${existing}" and "${project.id}" share the name "${project.name}"; note basenames would collide`,
      );
    }
    projectNames.set(nameKey, project.id);

    if (project.group && !groupIds.has(project.group)) {
      error(`project ${project.id} references unknown group ${project.group}`);
    }
    if (project.triggers.length === 0) {
      warn(`project ${project.id} has no recall triggers; the Recall Map route will be weak`);
    }
  }

  for (const project of manifest.projects) {
    if (!project.parent) continue;
    if (!projectIds.has(project.parent)) {
      error(`project ${project.id} references unknown parent ${project.parent}`);
      continue;
    }
    // Walk up to catch cycles, including self-parenting.
    const seen = new Set<string>([project.id]);
    let cursor: string | null = project.parent;
    while (cursor) {
      if (seen.has(cursor)) {
        error(`project hierarchy contains a cycle at ${project.id}`);
        break;
      }
      seen.add(cursor);
      cursor = manifest.projects.find((candidate) => candidate.id === cursor)?.parent ?? null;
    }
  }

  if (manifest.projects.length === 0) {
    warn("no projects defined; the vault will only contain its system layer");
  }

  return issues;
}
