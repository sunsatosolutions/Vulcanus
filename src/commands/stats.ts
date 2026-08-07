import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { noVaultProblem, reportProblem } from "../errors.js";
import { buildPlan, type VaultPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import * as p from "../ui.js";

/**
 * Characters per token, averaged. The real number depends on the tokenizer and
 * the language — English prose sits near 4, Turkish and heavily punctuated
 * Markdown closer to 3 — so this is deliberately reported as an estimate and
 * never as a bill. What matters here is the *ratio* between reading a capsule
 * and reading everything, and that ratio barely moves with the divisor.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface NoteCost {
  path: string;
  name: string;
  bytes: number;
  tokens: number;
}

export interface ProjectCost {
  project: string;
  /** The capsule alone: what an agent reads to route a task. */
  capsuleTokens: number;
  /** Capsule plus hub, decisions, rules, context, and specialized notes. */
  clusterTokens: number;
  notes: NoteCost[];
}

export interface StatsSummary {
  vault: string;
  root: string;
  charsPerToken: number;
  totals: {
    notes: number;
    bytes: number;
    tokens: number;
  };
  /** What an agent must read before it can route anything: the entry layer. */
  coldStart: {
    notes: NoteCost[];
    tokens: number;
  };
  /** Cold start plus one project's capsule — the intended read for one task. */
  typicalRecall: {
    project: string | null;
    tokens: number;
  };
  /** Reading the whole vault instead, which the protocol exists to avoid. */
  everything: number;
  /** Share of the vault a typical recall avoids reading, 0–1. */
  savedShare: number;
  projects: ProjectCost[];
  largest: NoteCost[];
}

async function costOf(vaultRoot: string, path: string, name: string): Promise<NoteCost | null> {
  const absolute = resolve(vaultRoot, path);
  if (!existsSync(absolute)) return null;
  const [content, info] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
  return { path, name, bytes: info.size, tokens: estimateTokens(content) };
}

export async function collectStats(vaultRoot: string): Promise<StatsSummary> {
  const manifest = await readManifest(vaultRoot);
  const plan: VaultPlan = buildPlan(manifest);

  const all: NoteCost[] = [];
  for (const note of plan.allNotes) {
    const cost = await costOf(vaultRoot, note.path, note.name);
    if (cost) all.push(cost);
  }
  const byPath = new Map(all.map((cost) => [cost.path, cost]));

  // The protocol's entry layer: AGENTS.md tells an agent how to read the vault,
  // the Recall Map routes the task, the Admin Profile says who it is working for.
  const coldStartNotes: NoteCost[] = [];
  const agents = await costOf(vaultRoot, "AGENTS.md", "AGENTS");
  if (agents) coldStartNotes.push(agents);
  for (const note of [plan.recallMap, plan.adminProfile]) {
    const cost = byPath.get(note.path);
    if (cost) coldStartNotes.push(cost);
  }
  const coldStartTokens = coldStartNotes.reduce((sum, note) => sum + note.tokens, 0);

  const projects: ProjectCost[] = plan.allProjects.map((entry) => {
    const notes = entry.notes
      .map((note) => byPath.get(note.path))
      .filter((note): note is NoteCost => note !== undefined);
    return {
      project: entry.project.name,
      capsuleTokens: byPath.get(entry.capsule.path)?.tokens ?? 0,
      clusterTokens: notes.reduce((sum, note) => sum + note.tokens, 0),
      notes,
    };
  });

  const totalTokens = all.reduce((sum, note) => sum + note.tokens, 0);
  const everything = totalTokens + (agents?.tokens ?? 0);

  // "Typical" is the median capsule, not the smallest: a report that quotes the
  // best case is a sales pitch, not a measurement.
  const capsules = projects.map((entry) => entry.capsuleTokens).sort((a, b) => a - b);
  const medianCapsule = capsules.length ? capsules[Math.floor(capsules.length / 2)] : 0;
  const medianProject =
    projects.find((entry) => entry.capsuleTokens === medianCapsule)?.project ?? null;
  const typicalTokens = coldStartTokens + medianCapsule;

  return {
    vault: manifest.vault.name,
    root: vaultRoot,
    charsPerToken: CHARS_PER_TOKEN,
    totals: {
      notes: all.length,
      bytes: all.reduce((sum, note) => sum + note.bytes, 0),
      tokens: totalTokens,
    },
    coldStart: { notes: coldStartNotes, tokens: coldStartTokens },
    typicalRecall: { project: medianProject, tokens: typicalTokens },
    everything,
    savedShare: everything > 0 ? Math.max(0, 1 - typicalTokens / everything) : 0,
    projects,
    largest: [...all].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
  };
}

export interface StatsOptions {
  cwd?: string;
  json?: boolean;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

export async function statsCommand(options: StatsOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus stats"));

  const summary = await collectStats(vaultRoot);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  p.intro(`stats — ${summary.vault}`);

  p.note(
    [
      `cold start   ${pad(summary.coldStart.tokens, 7)} tokens  (${summary.coldStart.notes
        .map((note) => note.name)
        .join(", ")})`,
      `+ capsule    ${pad(summary.typicalRecall.tokens, 7)} tokens  (typical recall${
        summary.typicalRecall.project ? `, e.g. ${summary.typicalRecall.project}` : ""
      })`,
      `whole vault  ${pad(summary.everything, 7)} tokens  (${summary.totals.notes} notes)`,
      "",
      `A task-scoped recall reads ${Math.round(summary.savedShare * 100)}% less than the vault.`,
    ].join("\n"),
    "Token budget",
  );

  if (summary.projects.length) {
    p.log.message(
      [
        "capsule  cluster  project",
        ...summary.projects.map(
          (entry) =>
            `${pad(entry.capsuleTokens, 7)}  ${pad(entry.clusterTokens, 7)}  ${entry.project}`,
        ),
      ].join("\n"),
    );
  }

  p.log.debug(
    ["tokens  note", ...summary.largest.map((note) => `${pad(note.tokens, 6)}  ${note.path}`)].join(
      "\n",
    ),
  );

  p.outro(
    `Estimated at ~${summary.charsPerToken} characters per token — compare the ratio, not the absolute count.`,
  );
  return 0;
}
