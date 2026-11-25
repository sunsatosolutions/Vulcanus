import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT, noVaultProblem, reportProblem, type Problem } from "../errors.js";
import { headingVariants } from "../generate/text.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import type { Locale } from "../i18n.js";
import { parseSections, stripComments } from "../memory/lifecycle.js";
import {
  RULE_FILES,
  applyBlock,
  checkRules,
  readBlock,
  renderBlock,
  type RulesReport,
} from "../memory/rules.js";
import * as p from "../ui.js";
import { expandHome } from "../util/paths.js";
import { findProject } from "./project.js";

export interface RulesLinkOptions {
  cwd?: string;
  /** Code repository the rules are written into. */
  root?: string;
  /** Write to disk. Without it the command only shows the difference. */
  write?: boolean;
  dryRun?: boolean;
}

export interface RulesCheckOptions {
  cwd?: string;
  root?: string;
  json?: boolean;
}

export interface LinkChange {
  file: string;
  action: "create" | "update" | "unchanged";
  before: string[];
  after: string[];
}

/** Capsule sections whose bullets are the rules an agent in the code repository needs. */
const RULE_SECTIONS = ["Must Remember", "Do Not Assume"];

function needRoot(root: string | undefined, command: string, cwd: string): string | Problem {
  if (!root) {
    return {
      what: `${command} needs --root.`,
      why: "It names the code repository the rules belong to.",
      fix: `${command} --root <dir>`,
    };
  }
  const dir = resolve(cwd, expandHome(root));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      what: `Root ${dir} is not a folder.`,
      why: "The rules live in this folder's agent files, and nothing is there.",
      fix: "Point --root at the code repository.",
    };
  }
  return dir;
}

function capsuleRules(text: string, path: string, language: Locale) {
  const lines = stripComments(text).split("\n");
  const wanted = new Set(RULE_SECTIONS.flatMap((name) => headingVariants(name, language)));
  const rules: string[] = [];
  for (const section of parseSections(path, text)) {
    if (!wanted.has(`## ${section.heading}`)) continue;
    let fence: string | null = null;
    let open = false;
    for (const line of lines.slice(section.line, section.endLine)) {
      const fenceMatch = /^\s*(```|~~~)/.exec(line);
      if (fenceMatch) {
        if (fence === null) fence = fenceMatch[1];
        else if (fenceMatch[1] === fence) fence = null;
        open = false;
        continue;
      }
      if (fence !== null) continue;
      if (line.trim() === "") {
        open = false;
        continue;
      }
      // A bullet's wrapped lines belong to the rule; keep them.
      if (!open && !/^\s*[-*]\s+\S/.test(line)) continue;
      open = true;
      // Wikilinks mean nothing outside the vault: keep the label.
      rules.push(
        line
          .trimEnd()
          .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
          .replace(/\[\[([^\]#]*)[^\]]*\]\]/g, "$1"),
      );
    }
  }
  return rules;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function rulesLinkCommand(
  projectQuery: string,
  options: RulesLinkOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  if (options.write && options.dryRun) {
    return reportProblem({
      what: "--write and --dry-run contradict each other.",
      fix: "Drop one: --dry-run is the default.",
    });
  }
  const root = needRoot(options.root, "vulcanus rules link", start);
  if (typeof root !== "string") return reportProblem(root);

  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus rules link"));
  const manifest = await readManifest(vaultRoot);
  const found = findProject(manifest, projectQuery);
  if (!found) {
    return reportProblem({
      what: `No project named "${projectQuery}" in ${manifest.vault.name}.`,
      why: `Known projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none yet"}.`,
      fix: "Use the name or id exactly as `vulcanus status` lists it.",
    });
  }
  const capsule = buildPlan(manifest).allProjects.find(
    (plan) => plan.project.id === found.id,
  )!.capsule;
  const capsuleText = await readOrNull(resolve(vaultRoot, capsule.path));
  if (capsuleText === null) {
    return reportProblem({
      what: `${capsule.path} does not exist.`,
      why: "The rules are read from the project's Capsule.",
      fix: "vulcanus doctor --repair",
    });
  }
  const rules = capsuleRules(capsuleText, capsule.path, manifest.vault.language);
  if (rules.length === 0) {
    return reportProblem({
      what: `${capsule.path} has no bullets under ${RULE_SECTIONS.join(" or ")}.`,
      why: "There is nothing to write into the code repository.",
      fix: "Add the rules as bullets in the Capsule.",
    });
  }
  const block = renderBlock(`${found.name} rules`, rules);

  const changes: LinkChange[] = [];
  const next = new Map<string, string>();
  for (const file of RULE_FILES) {
    const existing = await readOrNull(resolve(root, file));
    if (existing !== null && readBlock(existing).kind === "broken") {
      return reportProblem({
        what: `${file} has a damaged vulcanus rules block.`,
        why: "Writing would have to guess where the block ends, and your text sits around it.",
        fix: "Fix or remove the start and end markers by hand, then run the command again.",
      });
    }
    const text = applyBlock(existing, block, file);
    const read = existing === null ? null : readBlock(existing);
    changes.push({
      file,
      action: existing === null ? "create" : text === existing ? "unchanged" : "update",
      before: read?.kind === "ok" ? read.body.split(/\r?\n/) : [],
      after: block.split("\n"),
    });
    next.set(file, text);
  }

  p.intro(`rules link — ${found.name}`);
  for (const change of changes) {
    if (change.action === "unchanged") {
      p.log.success(`${change.file}: unchanged`);
      continue;
    }
    const diff = [
      ...change.before.map((line) => `- ${line}`.trimEnd()),
      ...change.after.map((line) => `+ ${line}`.trimEnd()),
    ];
    p.log.message(`${change.file}: ${change.action}\n${diff.join("\n")}`);
  }
  const pending = changes.filter((change) => change.action !== "unchanged");
  if (!options.write) {
    p.outro(
      pending.length
        ? `${pending.length} file${pending.length === 1 ? "" : "s"} would change. Nothing was written; add --write to apply.`
        : "No difference.",
    );
    return EXIT.ok;
  }
  for (const change of pending) {
    const target = resolve(root, change.file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, next.get(change.file)!);
  }
  p.outro(
    pending.length
      ? `Wrote ${pending.length} file${pending.length === 1 ? "" : "s"}.`
      : "No difference.",
  );
  return EXIT.ok;
}

export async function rulesCheckCommand(options: RulesCheckOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const root = needRoot(options.root, "vulcanus rules check", start);
  if (typeof root !== "string") return reportProblem(root);

  const texts = new Map<string, string | null>();
  for (const file of RULE_FILES) texts.set(file, await readOrNull(resolve(root, file)));
  const report: RulesReport | null = checkRules(root, texts);
  if (!report) {
    return reportProblem({
      what: `No vulcanus rules block in ${root}.`,
      why: `Looked in ${RULE_FILES.join(", ")}.`,
      fix: "vulcanus rules link <project> --root <dir> --write",
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? EXIT.ok : EXIT.failed;
  }

  p.intro(`rules check — ${root}`);
  if (report.ok) {
    p.log.success(
      `${report.claimsChecked} claim${report.claimsChecked === 1 ? "" : "s"} match; the copies agree.`,
    );
  } else {
    p.log.message(
      report.findings
        .map(
          (f) => `✖ ${f.file}${f.line ? `:${f.line}` : ""}  ${f.kind}  \`${f.text}\` — ${f.reason}`,
        )
        .join("\n"),
    );
  }
  p.outro(
    report.ok
      ? "No drift."
      : `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}. Nothing was written.`,
  );
  return report.ok ? EXIT.ok : EXIT.failed;
}
