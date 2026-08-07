import {
  CORE_SYSTEM_NOTES,
  FULL_SYSTEM_NOTES,
  type ProjectGroup,
  type ProjectNode,
  type VaultManifest,
} from "./schema.js";
import { safeFileName } from "../util/text.js";

/** A generated note, addressable both as a file path and as a wikilink target. */
export interface NoteRef {
  /** Wikilink target and file basename without the extension. */
  name: string;
  /** Vault-relative path including the `.md` extension. */
  path: string;
}

export interface ProjectPlan {
  project: ProjectNode;
  /** Vault-relative directory holding this project's cluster. */
  dir: string;
  capsule: NoteRef;
  hub: NoteRef;
  context: NoteRef;
  decisions: NoteRef;
  rules: NoteRef;
  /** Specialized notes keyed by their kind, e.g. "Architecture". */
  specialized: Array<{ kind: string; note: NoteRef }>;
  /** Every note in the cluster, including the hub. */
  notes: NoteRef[];
  /** Where this project's hub links upward. */
  parentLink: NoteRef;
  children: ProjectPlan[];
  /** Ancestor chain, outermost first. */
  ancestors: ProjectNode[];
}

export interface GroupPlan {
  group: ProjectGroup;
  hub: NoteRef;
  members: ProjectPlan[];
}

export interface VaultPlan {
  manifest: VaultManifest;
  /** System notes keyed by kind, e.g. "Index" or "Recall Map". */
  system: Map<string, NoteRef>;
  systemHub: NoteRef;
  index: NoteRef;
  recallMap: NoteRef;
  adminProfile: NoteRef;
  groups: GroupPlan[];
  /** Top-level projects, each carrying its own subtree. */
  roots: ProjectPlan[];
  /** Flat list of every project plan in the vault. */
  allProjects: ProjectPlan[];
  /** Every markdown note the generator owns, in stable order. */
  allNotes: NoteRef[];
}

function systemNoteName(manifest: VaultManifest, kind: string): string {
  if (manifest.vault.naming === "generic") return kind;
  return `${manifest.vault.name} ${kind}`;
}

function systemNoteRef(manifest: VaultManifest, kind: string): NoteRef {
  const name = safeFileName(systemNoteName(manifest, kind));
  return { name, path: `${manifest.structure.systemDir}/${name}.md` };
}

function projectNoteRef(dir: string, projectName: string, kind: string): NoteRef {
  const name = safeFileName(`${projectName} ${kind}`);
  return { name, path: `${dir}/${name}.md` };
}

export function systemNoteKinds(manifest: VaultManifest): string[] {
  return manifest.vault.profile === "full"
    ? [...CORE_SYSTEM_NOTES, ...FULL_SYSTEM_NOTES]
    : [...CORE_SYSTEM_NOTES];
}

export function projectDirName(project: ProjectNode): string {
  return safeFileName(project.dirName?.trim() || project.name);
}

/** Resolve every path, note name, and link target implied by the manifest. */
export function buildPlan(manifest: VaultManifest): VaultPlan {
  const system = new Map<string, NoteRef>();
  for (const kind of systemNoteKinds(manifest)) {
    system.set(kind, systemNoteRef(manifest, kind));
  }

  // The System Hub keeps a stable name in both naming modes so agents can find it.
  const systemHub: NoteRef = {
    name: "System Hub",
    path: `${manifest.structure.systemDir}/System Hub.md`,
  };
  system.set("System Hub", systemHub);

  const index = system.get("Index")!;
  const recallMap = system.get("Recall Map")!;
  const adminProfile = system.get("Admin Profile")!;

  const groupHubs = new Map<string, NoteRef>();
  for (const group of manifest.groups) {
    const name = safeFileName(`${group.name} Hub`);
    groupHubs.set(group.id, { name, path: `${manifest.structure.projectsDir}/${name}.md` });
  }

  const byId = new Map(manifest.projects.map((project) => [project.id, project]));
  const childrenOf = new Map<string | null, ProjectNode[]>();
  for (const project of manifest.projects) {
    const key = project.parent ?? null;
    const bucket = childrenOf.get(key) ?? [];
    bucket.push(project);
    childrenOf.set(key, bucket);
  }

  const allProjects: ProjectPlan[] = [];

  const buildProject = (project: ProjectNode, ancestors: ProjectNode[]): ProjectPlan => {
    const segments = [...ancestors, project].map(projectDirName);
    const dir = [manifest.structure.projectsDir, ...segments].join("/");

    const capsule = projectNoteRef(dir, project.name, "Capsule");
    const hub = projectNoteRef(dir, project.name, "Hub");
    const context = projectNoteRef(dir, project.name, "Context");
    const decisions = projectNoteRef(dir, project.name, "Decisions");
    const rules = projectNoteRef(dir, project.name, "Rules");
    const specialized = project.specialized.map((kind) => ({
      kind,
      note: projectNoteRef(dir, project.name, kind),
    }));

    const parentProject = project.parent ? byId.get(project.parent) : undefined;
    let parentLink: NoteRef;
    if (parentProject) {
      const parentSegments = ancestors.map(projectDirName);
      const parentDir = [manifest.structure.projectsDir, ...parentSegments].join("/");
      parentLink = projectNoteRef(parentDir, parentProject.name, "Hub");
    } else if (project.group && groupHubs.has(project.group)) {
      parentLink = groupHubs.get(project.group)!;
    } else {
      parentLink = index;
    }

    const plan: ProjectPlan = {
      project,
      dir,
      capsule,
      hub,
      context,
      decisions,
      rules,
      specialized,
      notes: [capsule, hub, context, decisions, rules, ...specialized.map((entry) => entry.note)],
      parentLink,
      children: [],
      ancestors,
    };

    allProjects.push(plan);
    plan.children = (childrenOf.get(project.id) ?? []).map((child) =>
      buildProject(child, [...ancestors, project]),
    );
    return plan;
  };

  const roots = (childrenOf.get(null) ?? []).map((project) => buildProject(project, []));

  const groups: GroupPlan[] = manifest.groups.map((group) => ({
    group,
    hub: groupHubs.get(group.id)!,
    members: allProjects.filter(
      (plan) => plan.project.group === group.id && plan.project.parent === null,
    ),
  }));

  const allNotes: NoteRef[] = [
    ...systemNoteKinds(manifest).map((kind) => system.get(kind)!),
    systemHub,
    ...groups.map((entry) => entry.hub),
    ...allProjects.flatMap((plan) => plan.notes),
  ];

  return {
    manifest,
    system,
    systemHub,
    index,
    recallMap,
    adminProfile,
    groups,
    roots,
    allProjects,
    allNotes,
  };
}

/**
 * Wikilink targets each hub is required to contain. The doctor compares this to
 * what is actually written. The expectations are derived from the manifest, so
 * they stay correct for any project tree instead of being hardcoded.
 */
export function hubExpectations(plan: VaultPlan): Map<string, Set<string>> {
  const expectations = new Map<string, Set<string>>();

  const systemTargets = new Set<string>();
  for (const kind of systemNoteKinds(plan.manifest)) {
    systemTargets.add(plan.system.get(kind)!.name);
  }
  expectations.set(plan.systemHub.path, systemTargets);

  const indexTargets = new Set<string>([plan.systemHub.name, plan.recallMap.name]);
  for (const group of plan.groups) indexTargets.add(group.hub.name);
  for (const root of plan.roots) {
    if (!root.project.group) indexTargets.add(root.hub.name);
  }
  if (plan.manifest.vault.profile === "full") {
    indexTargets.add(plan.system.get("Brain OS Architecture")!.name);
    indexTargets.add(plan.system.get("Operating Intuition")!.name);
  }
  expectations.set(plan.index.path, indexTargets);

  for (const group of plan.groups) {
    const targets = new Set<string>([plan.index.name]);
    for (const member of group.members) targets.add(member.hub.name);
    expectations.set(group.hub.path, targets);
  }

  for (const project of plan.allProjects) {
    const targets = new Set<string>([
      project.capsule.name,
      project.context.name,
      project.decisions.name,
      project.rules.name,
      project.parentLink.name,
    ]);
    for (const entry of project.specialized) targets.add(entry.note.name);
    for (const child of project.children) targets.add(child.hub.name);
    expectations.set(project.hub.path, targets);
  }

  return expectations;
}

/** Non-hub project notes must link back to their own hub. */
export function returnLinkExpectations(plan: VaultPlan): Map<string, string> {
  const expectations = new Map<string, string>();
  for (const project of plan.allProjects) {
    for (const note of project.notes) {
      if (note.path === project.hub.path) continue;
      expectations.set(note.path, project.hub.name);
    }
  }
  return expectations;
}

/** Every project needs a Capsule and Hub reachable from the Recall Map. */
export function recallRouteExpectations(plan: VaultPlan): Set<string> {
  const targets = new Set<string>();
  for (const project of plan.allProjects) {
    targets.add(project.capsule.name);
    targets.add(project.hub.name);
  }
  return targets;
}
