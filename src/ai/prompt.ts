import { resolve } from "node:path";
import { hubExpectations, type ProjectPlan, type VaultPlan } from "../manifest/derive.js";

export interface HandoffTarget {
  project: ProjectPlan;
  /** Absolute path of the codebase the notes must be written from. */
  sourceDir: string;
}

const ROLES: Record<string, string> = {
  Capsule: "the compressed must-remember summary an agent reads first",
  Hub: "navigation only — the cluster boundary",
  Context: "identity, definitions, scope",
  Decisions: "confirmed choices and corrections, newest first",
  Rules: "constraints on future behavior",
};

interface NoteHandle {
  kind: string;
  /** Wikilink target and note name. */
  name: string;
  /** Absolute path, so the AI never has to guess where a note lives. */
  path: string;
  role: string;
}

/**
 * The exact notes an AI session is allowed to rewrite, resolved from the plan
 * rather than reconstructed from the project name — a guessed path would send
 * the session writing a new note beside the real one.
 */
export function editableNotes(vaultRoot: string, project: ProjectPlan): NoteHandle[] {
  const entries: Array<[string, { name: string; path: string }]> = [
    ["Capsule", project.capsule],
    ["Hub", project.hub],
    ["Context", project.context],
    ["Decisions", project.decisions],
    ["Rules", project.rules],
    ...project.specialized.map(
      (entry) => [entry.kind, entry.note] as [string, { name: string; path: string }],
    ),
  ];

  return entries.map(([kind, note]) => ({
    kind,
    name: note.name,
    path: resolve(vaultRoot, note.path),
    role: ROLES[kind] ?? `domain depth: ${kind.toLowerCase()}`,
  }));
}

/**
 * The task handed to the AI CLI. It has to carry everything `vulcanus doctor`
 * enforces, because the session runs outside the vault and an edit that breaks
 * an invariant only surfaces afterwards.
 */
export function buildHandoffPrompt(
  plan: VaultPlan,
  vaultRoot: string,
  target: HandoffTarget,
): string {
  const name = target.project.project.name;
  const notes = editableNotes(vaultRoot, target.project);
  const hubLinks = [...(hubExpectations(plan).get(target.project.hub.path) ?? [])];
  const language = plan.manifest.vault.language === "tr" ? "Turkish" : "English";

  return [
    `You are filling in the memory notes for the project "${name}" in ${plan.manifest.vault.name}, a Vulcanus second-brain vault at ${vaultRoot}.`,
    "",
    `The source of truth for this project is the codebase in ${target.sourceDir}, your working directory.`,
    "",
    "Do this, in order:",
    "1. Study the codebase until you can describe what this project is, what it is not, how it is built, and which decisions are already settled in it.",
    "2. Ask the operator, interactively, about everything the code cannot tell you — ownership, intent, roadmap, constraints, what is deliberately out of scope. Ask before writing. Never guess at a fact and never invent history.",
    "3. Write the notes below, and only those notes.",
    "",
    "Notes you may edit:",
    ...notes.map((note) => `- ${note.path}\n  ${note.name} — ${note.role}`),
    "",
    "The vault is validated by `vulcanus doctor`. An edit that breaks any of these is a failure:",
    "- Every note keeps its YAML frontmatter block with `type`, `project`, `status`, and `tags`. No key may be empty, duplicated, or removed, `tags` needs at least one entry, and the Capsule's `type` must stay `capsule`.",
    `- Every wikilink \`[[Note Name]]\` must resolve to exactly one note that already exists in the vault. Do not link to a note you have not seen.`,
    `- Every note above except the Hub must link back to [[${target.project.hub.name}]].`,
    `- ${target.project.hub.name} must keep links to: ${hubLinks.map((link) => `[[${link}]]`).join(", ")}.`,
    "- Note names are unique across the whole vault, including case. Do not rename, move, create, or delete any file.",
    "",
    "House style:",
    `- Write in ${language}, in the operator's own terms.`,
    "- Durable memory only: confirmed facts, not narration of this session.",
    "- Anything still unconfirmed goes under the note's `Needs Confirmation` heading instead of being asserted.",
    "- Replace the seed placeholder lines; keep the existing headings.",
    "- Do not edit vulcanus.json, any note outside the list above, or anything in the source repository.",
    "",
    "Stop when the notes are written and tell the operator what you changed.",
  ].join("\n");
}
