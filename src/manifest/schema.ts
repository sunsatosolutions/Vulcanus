import { slugify } from "../util/text.js";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = "vulcanus.json";

export type Language = "en" | "tr" | "de" | "es";
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

/**
 * What a project *is*, when the operator wants that recorded. Optional: plenty
 * of vaults never need the distinction, and a vault that does should not have
 * to invent it in a note where nothing can read it.
 */
export const PROJECT_KINDS = [
  "umbrella",
  "product",
  "lab",
  "service-brand",
  "client",
  "client-product",
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * Whether a project may be spoken about outside the vault. This is a signal for
 * agents, not access control: nothing here encrypts or hides a file. It answers
 * the question an agent cannot otherwise answer — may I put this in a public
 * README, a commit message, an issue?
 */
export const PROJECT_VISIBILITIES = ["public", "private"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

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
  /** What the project is; omitted when the vault does not track it. */
  kind?: ProjectKind;
  /** Whether an agent may reveal this project outside the vault. */
  visibility?: ProjectVisibility;
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
  /**
   * System notes the operator writes and this CLI only has to know about.
   *
   * The generated system layer is a fixed list per profile, which left no way
   * to say "this note under the system directory is mine and it belongs".
   * Without that, an operator's own note reads as unmanaged and the System Hub
   * that links it reads as over-linked — two warnings for doing nothing wrong.
   *
   * Declared as kinds, not filenames: they go through the same branding as the
   * generated ones, so `Release Notes` is `<Vault> Release Notes` in a branded
   * vault and `Release Notes` in a generic one. Nothing here is ever written or
   * rewritten by the generator; declaring a note only makes the vault aware of
   * one the operator already keeps.
   */
  systemNotes: string[];
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

  const generatedKinds = new Set<string>([
    ...CORE_SYSTEM_NOTES,
    ...FULL_SYSTEM_NOTES,
    "System Hub",
  ]);
  const declaredNotes = new Set<string>();
  for (const kind of manifest.systemNotes ?? []) {
    const trimmed = typeof kind === "string" ? kind.trim() : "";
    if (!trimmed) {
      error("systemNotes contains an empty name");
      continue;
    }
    if (generatedKinds.has(trimmed)) {
      error(`systemNotes declares "${trimmed}", which this CLI already generates`);
      continue;
    }
    const key = trimmed.toLowerCase();
    if (declaredNotes.has(key)) error(`duplicate system note: ${trimmed}`);
    declaredNotes.add(key);
  }

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

    // Warnings, not errors: both axes are optional and operator-owned, and a
    // value this CLI does not know is more likely a vocabulary the operator is
    // trying out than a mistake. Saying nothing would let a typo like
    // `visibility: privte` read as public to every agent, which is the failure
    // that matters.
    if (project.kind !== undefined && !PROJECT_KINDS.includes(project.kind)) {
      warn(
        `project "${project.id}" has kind "${String(project.kind)}", which is not one of: ${PROJECT_KINDS.join(", ")}`,
      );
    }
    if (project.visibility !== undefined && !PROJECT_VISIBILITIES.includes(project.visibility)) {
      warn(
        `project "${project.id}" has visibility "${String(project.visibility)}", which is not one of: ${PROJECT_VISIBILITIES.join(", ")}; agents will not treat it as private`,
      );
    }

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
