import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT, noVaultProblem, reportProblem, type Problem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import {
  RULE_FILES,
  checkRepo,
  linkedRepos,
  planLink,
  type LinkChange,
  type RulesReport,
} from "../memory/rules.js";
import * as p from "../ui.js";
import { expandHome } from "../util/paths.js";
import { findProject } from "./project.js";

export type { LinkChange };

export interface RulesLinkOptions {
  cwd?: string;
  /** Code repository the rules are written into; defaults to the project's `root`. */
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

function resolveRoot(root: string, cwd: string): string | Problem {
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

function needRoot(root: string | undefined, command: string, cwd: string): string | Problem {
  if (!root) {
    return {
      what: `${command} needs --root.`,
      why: "It names the code repository the rules belong to.",
      fix: `${command} --root <dir>`,
    };
  }
  return resolveRoot(root, cwd);
}

export async function rulesLinkCommand(
  projectQuery: string | undefined,
  options: RulesLinkOptions = {},
): Promise<number> {
  const start = options.cwd ?? process.cwd();
  if (options.write && options.dryRun) {
    return reportProblem({
      what: "--write and --dry-run contradict each other.",
      fix: "Drop one: --dry-run is the default.",
    });
  }
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus rules link"));
  const manifest = await readManifest(vaultRoot);

  const targets: { id: string; name: string; root: string }[] = [];
  if (projectQuery) {
    const found = findProject(manifest, projectQuery);
    if (!found) {
      return reportProblem({
        what: `No project named "${projectQuery}" in ${manifest.vault.name}.`,
        why: `Known projects: ${manifest.projects.map((entry) => entry.name).join(", ") || "none yet"}.`,
        fix: "Use the name or id exactly as `vulcanus status` lists it.",
      });
    }
    const named = options.root ?? (typeof found.root === "string" ? found.root : undefined);
    const base = options.root ? start : vaultRoot;
    const root = needRoot(named, "vulcanus rules link", base);
    if (typeof root !== "string") return reportProblem(root);
    targets.push({ id: found.id, name: found.name, root });
  } else {
    if (options.root) {
      return reportProblem({
        what: "--root needs a project.",
        fix: "vulcanus rules link <project> --root <dir>",
      });
    }
    targets.push(...(await linkedRepos(vaultRoot, manifest)));
    if (targets.length === 0) {
      return reportProblem({
        what: "No linked code repository in this vault.",
        why: "A repository counts as linked when a project's `root` already holds a rules block.",
        fix: "vulcanus rules link <project> --root <dir> --write",
      });
    }
  }

  const plans = [];
  for (const target of targets) {
    const plan = await planLink(vaultRoot, manifest, target.id, target.root);
    if (!plan.ok) return reportProblem(plan.problem);
    plans.push(plan);
  }

  p.intro(`rules link — ${manifest.vault.name}`);
  let pending = 0;
  for (const plan of plans) {
    if (plans.length > 1) p.log.info(`${plan.project} → ${plan.root}`);
    for (const change of plan.changes) {
      if (change.action === "unchanged") {
        p.log.success(`${change.file}: unchanged`);
        continue;
      }
      pending++;
      const diff = [
        ...change.before.map((line) => `- ${line}`.trimEnd()),
        ...change.after.map((line) => `+ ${line}`.trimEnd()),
      ];
      p.log.message(`${change.file}: ${change.action}\n${diff.join("\n")}`);
    }
  }
  const files = `${pending} file${pending === 1 ? "" : "s"}`;
  if (!options.write) {
    p.outro(
      pending
        ? `${files} would change. Nothing was written; add --write to apply.`
        : "No difference.",
    );
    return EXIT.ok;
  }
  for (const plan of plans) {
    for (const change of plan.changes) {
      if (change.action === "unchanged") continue;
      const target = resolve(plan.root, change.file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, plan.next.get(change.file)!);
    }
  }
  p.outro(pending ? `Wrote ${files}.` : "No difference.");
  return EXIT.ok;
}

function printReport(report: RulesReport): void {
  p.intro(`rules check — ${report.root}`);
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
}

export async function rulesCheckCommand(options: RulesCheckOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();

  // Without --root: every linked repository of the vault. Nothing linked is not a failure,
  // so the pre-commit hook can call this on any vault.
  if (!options.root) {
    const vaultRoot = findVaultRoot(start);
    if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus rules check"));
    const repos = await linkedRepos(vaultRoot, await readManifest(vaultRoot));
    const reports: RulesReport[] = [];
    for (const repo of repos) {
      const report = await checkRepo(repo.root);
      if (report) reports.push(report);
    }
    const ok = reports.every((report) => report.ok);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    } else if (reports.length === 0) {
      p.log.info("No linked code repository; nothing to check.");
    } else {
      for (const report of reports) printReport(report);
    }
    return ok ? EXIT.ok : EXIT.failed;
  }

  const root = needRoot(options.root, "vulcanus rules check", start);
  if (typeof root !== "string") return reportProblem(root);
  const report = await checkRepo(root);
  if (!report) {
    return reportProblem({
      what: `No vulcanus rules block in ${root}.`,
      why: `Looked in ${RULE_FILES.join(", ")}.`,
      fix: "vulcanus rules link <project> --root <dir> --write",
    });
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printReport(report);
  return report.ok ? EXIT.ok : EXIT.failed;
}

export interface RulesRefresh {
  repos: number;
  /** Files whose block differs from the current Capsule rules. */
  pending: number;
  written: boolean;
}

/**
 * Bring every linked repository up to the Capsule's current rules. Without
 * `write` it only counts what would change, so callers can hint at it.
 */
export async function refreshLinkedRules(
  vaultRoot: string,
  write: boolean,
): Promise<RulesRefresh | null> {
  const manifest = await readManifest(vaultRoot);
  const repos = await linkedRepos(vaultRoot, manifest);
  if (repos.length === 0) return null;
  let pending = 0;
  for (const repo of repos) {
    const plan = await planLink(vaultRoot, manifest, repo.id, repo.root);
    if (!plan.ok) continue;
    for (const change of plan.changes) {
      if (change.action === "unchanged") continue;
      pending++;
      if (!write) continue;
      const target = resolve(repo.root, change.file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, plan.next.get(change.file)!);
    }
  }
  return { repos: repos.length, pending, written: write && pending > 0 };
}
