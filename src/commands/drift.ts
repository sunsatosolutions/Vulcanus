import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadVaultNotes } from "../doctor/index.js";
import { EXIT, reportProblem, type Problem } from "../errors.js";
import { buildPlan, type NoteRef, type ProjectPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { noVaultProblem } from "../errors.js";
import { extractClaims, findDrift, type Drift } from "../memory/drift.js";
import { headingLink, parseSections, sectionAt, today } from "../memory/lifecycle.js";
import * as p from "../ui.js";
import { expandHome } from "../util/paths.js";
import { findProject } from "./project.js";

export interface DriftOptions {
  cwd?: string;
  /** Source folder to compare against, instead of the one in `vulcanus.json`. */
  root?: string;
  json?: boolean;
  /** ISO date lifecycle treats as today; injectable for tests. */
  today?: string;
}

export interface Suggestion {
  /** The section to supersede; null when the line sits under no `## ` heading. */
  heading: string | null;
  /** Field lines to add under that heading; empty when there is no heading. */
  fields: string[];
  text: string;
}

export interface DriftFinding {
  project: string;
  /** Vault-relative note path. */
  note: string;
  line: number;
  claim: string;
  kind: Drift["kind"];
  reason: string;
  suggestion: Suggestion;
}

export interface ProjectDrift {
  project: string;
  root: string;
  claimsChecked: number;
  findings: DriftFinding[];
}

export interface DriftReport {
  vault: string;
  ok: boolean;
  projects: ProjectDrift[];
  /** Projects with no source root, left out of the comparison. */
  skipped: string[];
}

function noRootProblem(name: string, id: string): Problem {
  return {
    what: `Project "${name}" has no source root, so drift has nothing to compare its notes against.`,
    why: "vulcanus.json lists no `root` for it, and --root was not given.",
    fix: [
      `Set it once, in the project's entry in vulcanus.json:   "root": "../${id}"`,
      `or pass it for one run:   vulcanus drift "${name}" --root ../${id}`,
    ],
  };
}

function badRootProblem(root: string): Problem {
  return {
    what: `Source root ${root} is not a folder.`,
    why: "drift reads the project's code from it, and nothing is there.",
    fix: "Point `root` in vulcanus.json (or --root) at the project's source folder.",
  };
}

function suggest(note: NoteRef, heading: string | null, on: string): Suggestion {
  if (heading === null) {
    return {
      heading: null,
      fields: [],
      text: "no `##` section holds this line; correct it in place",
    };
  }
  const fields = [
    `superseded-by:: ${headingLink(note.name, "<replacement heading>")}`,
    `superseded-on:: ${on}`,
  ];
  return {
    heading,
    fields,
    text: `supersede "## ${heading}": write its replacement, then add under it: ${fields.join("  ")}`,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export async function driftCommand(
  projectQuery: string | undefined,
  options: DriftOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus drift"));

  const manifest = await readManifest(vaultRoot);
  const on = options.today ?? today();
  const plans = buildPlan(manifest).allProjects;

  let targets: ProjectPlan[];
  if (projectQuery) {
    const found = findProject(manifest, projectQuery);
    if (!found) {
      return reportProblem({
        what: `No project named "${projectQuery}" in ${manifest.vault.name}.`,
        why: `Known projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none yet"}.`,
        fix: "Use the name or id exactly as `vulcanus status` lists it.",
      });
    }
    targets = plans.filter((plan) => plan.project.id === found.id);
  } else {
    if (options.root) {
      return reportProblem({
        what: "--root needs a project.",
        why: "One folder cannot stand for every project in the vault.",
        fix: `vulcanus drift <project> --root ${options.root}`,
      });
    }
    targets = plans.filter((plan) => plan.project.root);
  }

  const resolved: Array<{ plan: ProjectPlan; root: string }> = [];
  const skipped: string[] = [];
  for (const plan of targets) {
    const declared = options.root ? resolve(start, expandHome(options.root)) : undefined;
    const fromManifest =
      typeof plan.project.root === "string"
        ? resolve(vaultRoot, expandHome(plan.project.root))
        : undefined;
    const root = declared ?? fromManifest;
    if (!root) {
      return reportProblem(noRootProblem(plan.project.name, plan.project.id));
    }
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      return reportProblem(badRootProblem(root));
    }
    resolved.push({ plan, root });
  }
  if (!projectQuery) {
    skipped.push(...plans.filter((plan) => !plan.project.root).map((plan) => plan.project.name));
    if (resolved.length === 0) {
      const first = plans[0]?.project;
      return reportProblem(
        first
          ? noRootProblem(first.name, first.id)
          : {
              what: "This vault has no projects, so drift has nothing to check.",
              fix: "vulcanus add project <name>",
            },
      );
    }
  }

  const { contents } = await loadVaultNotes(vaultRoot, manifest);
  const projects: ProjectDrift[] = [];

  for (const { plan, root } of resolved) {
    const result: ProjectDrift = {
      project: plan.project.name,
      root,
      claimsChecked: 0,
      findings: [],
    };
    for (const note of [plan.capsule, plan.rules, plan.decisions]) {
      const text = contents.get(note.path);
      if (text === undefined) continue;
      const sections = parseSections(note.path, text);
      const claims = extractClaims(text, sections, on);
      result.claimsChecked += claims.length;
      for (const drift of findDrift(claims, root)) {
        result.findings.push({
          project: plan.project.name,
          note: note.path,
          line: drift.line,
          claim: drift.text,
          kind: drift.kind,
          reason: drift.reason,
          suggestion: suggest(note, sectionAt(sections, drift.line)?.heading ?? null, on),
        });
      }
    }
    projects.push(result);
  }

  const total = projects.reduce((sum, entry) => sum + entry.findings.length, 0);
  const report: DriftReport = { vault: manifest.vault.name, ok: total === 0, projects, skipped };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return total ? EXIT.failed : EXIT.ok;
  }

  p.intro(`drift — ${manifest.vault.name}`);
  for (const entry of projects) {
    if (entry.findings.length === 0) {
      p.log.success(
        `${entry.project}: ${plural(entry.claimsChecked, "claim")} match ${entry.root}`,
      );
      continue;
    }
    const lines = entry.findings.flatMap((finding) => [
      `✖ ${finding.note}:${finding.line}  \`${finding.claim}\` — ${finding.reason}`,
      `    ${finding.suggestion.text}`,
    ]);
    p.log.message(`${entry.project}  (${entry.root})\n${lines.join("\n")}`);
  }
  if (skipped.length) p.log.info(`No source root, skipped: ${skipped.join(", ")}`);
  p.outro(
    total
      ? `${plural(total, "stale claim")}. Nothing was written; the supersede lines are suggestions.`
      : "No drift.",
  );
  return total ? EXIT.failed : EXIT.ok;
}
