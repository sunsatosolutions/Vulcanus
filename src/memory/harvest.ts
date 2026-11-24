/**
 * Harvest: decisions the operator's commit messages already give reasons for.
 *
 * Git is read locally through `execFile` — no shell, no network, no hosting
 * API. Commits whose title or body state a reason ("because", "instead of",
 * "revert", "neden", "yerine", "weil", "porque") become candidates in the same
 * shape the import inbox reviews, so they share its scoring, its cap, and its
 * review. Nothing here writes to the vault, and only the sentence that carries
 * the reason (plus the title) ever becomes a candidate: never a whole body.
 */
import type { VaultPlan } from "../manifest/derive.js";
import { git, gitOrNull } from "../util/git.js";
import { classify, CUES, RATIONALE_CUES } from "./cues.js";
import {
  MAX_CANDIDATES_PER_PROJECT,
  rankCandidates,
  sentencesOf,
  type MemoryCandidate,
  type SentenceHit,
} from "./extract.js";

export const DEFAULT_SINCE = "30d";
/** A commit touching more files than this records only the first ones. */
export const MAX_PATHS = 20;
const MAX_COMMITS = 5000;

export class HarvestError extends Error {}

export interface Commit {
  sha: string;
  /** Epoch milliseconds. */
  time: number;
  subject: string;
  body: string;
}

/** `30d` means the last 30 days; anything else must be a tag or ref, read as `<ref>..HEAD`. */
export async function sinceArgs(codeDir: string, since: string = DEFAULT_SINCE): Promise<string[]> {
  const days = /^(\d{1,4})d$/.exec(since);
  if (days) return [`--since=${days[1]} days ago`];
  const known =
    !since.startsWith("-") &&
    (await gitOrNull(codeDir, ["rev-parse", "--verify", "--quiet", `${since}^{commit}`])) !== null;
  if (!known) {
    throw new HarvestError(
      `--since "${since}" is neither a number of days like 30d nor a tag or commit in ${codeDir}`,
    );
  }
  return [`${since}..HEAD`];
}

export async function readCommits(codeDir: string, since: string): Promise<Commit[]> {
  if ((await gitOrNull(codeDir, ["rev-parse", "--git-dir"])) === null) {
    throw new HarvestError(`${codeDir} is not a git repository`);
  }
  const range = await sinceArgs(codeDir, since);
  const out = await gitOrNull(codeDir, [
    "log",
    "--no-merges",
    `--max-count=${MAX_COMMITS}`,
    "--format=%H%x1f%ct%x1f%s%x1f%b%x1e",
    ...range,
  ]);
  if (out === null) throw new HarvestError(`${codeDir} has no commits to read`);
  return out
    .split("\x1e")
    .map((record) => record.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, time, subject, body] = record.split("\x1f");
      return { sha, time: Number(time) * 1000, subject: subject.trim(), body: body ?? "" };
    });
}

/** Files a commit changed, repo-relative, without renames folded in. */
export async function changedFiles(codeDir: string, sha: string): Promise<string[]> {
  const out = await git(codeDir, [
    "diff-tree",
    "-r",
    "--root",
    "--no-commit-id",
    "--no-renames",
    "--name-only",
    "-z",
    sha,
  ]);
  return out.split("\0").filter(Boolean);
}

/** Names that would break a `paths::` list are left out rather than quoted. */
export function recordablePaths(paths: string[]): string[] {
  return paths
    .filter((path) => !/[,\r\n]|<!--/.test(path) && path === path.trim())
    .slice(0, MAX_PATHS);
}

const TRAILER = /^[\w-]+:\s.*<[^>]+@[^>]+>\s*$/;
const ALL_CUES = [...CUES, ...RATIONALE_CUES];

/**
 * The statement a commit makes, or null when it gives no reason. The title
 * alone when it carries the cue; otherwise the title and the one body sentence
 * that does, so the candidate still reads on its own.
 */
export function commitStatement(
  commit: Commit,
): { text: string; weight: number; kind: "decision" | "rule"; correction: boolean } | null {
  const body = commit.body
    .split(/\r?\n/)
    .filter((line) => !TRAILER.test(line.trim()))
    .join("\n");
  const subject = sentencesOf(commit.subject);
  for (const sentence of [...subject, ...sentencesOf(body)]) {
    const match = classify(sentence, ALL_CUES);
    if (!match) continue;
    const isSubject = subject.includes(sentence);
    return {
      text: isSubject || !commit.subject ? sentence : `${commit.subject} — ${sentence}`,
      ...match,
    };
  }
  return null;
}

/**
 * The project a set of changed files belongs to: the first directory of every
 * file must name the same manifest project (by id or name). Files at the
 * repository root say nothing. Anything less certain is left for the operator.
 */
export function projectForPaths(plan: VaultPlan, paths: string[]): string | undefined {
  const dirs = new Set(
    paths.filter((path) => path.includes("/")).map((path) => path.split("/")[0].toLowerCase()),
  );
  const names = new Set<string>();
  for (const dir of dirs) {
    const found = plan.allProjects.find(
      (entry) => entry.project.id.toLowerCase() === dir || entry.project.name.toLowerCase() === dir,
    );
    if (!found) return undefined;
    names.add(found.project.name);
  }
  return names.size === 1 ? [...names][0] : undefined;
}

/**
 * Ranked candidates from a repository's recent commits. A candidate whose
 * commit touched no single manifest project has an empty `project`; the caller
 * asks the operator, and never creates one from a directory name.
 */
export async function harvestCandidates(
  plan: VaultPlan,
  codeDir: string,
  since: string = DEFAULT_SINCE,
  now: number = Date.now(),
): Promise<{ candidates: MemoryCandidate[]; commits: number }> {
  const commits = await readCommits(codeDir, since);
  const hits: SentenceHit[] = [];
  const evidence = new Map<string, string[]>();
  const bySha = new Map<string, SentenceHit>();

  for (const commit of commits) {
    const statement = commitStatement(commit);
    if (!statement) continue;
    const paths = await changedFiles(codeDir, commit.sha);
    const project = projectForPaths(plan, paths) ?? "";
    evidence.set(commit.sha, recordablePaths(paths));
    const hit: SentenceHit = {
      id: `${commit.sha}#1`,
      conversationId: commit.sha,
      source: "git",
      project,
      kind: statement.kind,
      weight: statement.weight,
      correction: statement.correction,
      text: statement.text,
      time: commit.time,
    };
    hits.push(hit);
    bySha.set(commit.sha, hit);
  }

  const candidates = rankCandidates(hits, now).map((candidate) => {
    // Same pick as rankCandidates' `latest`, so sha and paths come from one commit.
    const hit = candidate.sentenceIds
      .map((id) => bySha.get(id.split("#")[0])!)
      .filter((entry) => entry.text === candidate.text)
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || b.weight - a.weight)[0];
    return {
      ...candidate,
      commit: {
        sha: hit.conversationId,
        paths: evidence.get(hit.conversationId) ?? [],
      },
    };
  });
  return { candidates, commits: commits.length };
}

/** At most the per-project cap of strongest candidates, once projects are settled. */
export function capPerProject(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Map<string, number>();
  return [...candidates]
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const count = seen.get(candidate.project) ?? 0;
      seen.set(candidate.project, count + 1);
      return count < MAX_CANDIDATES_PER_PROJECT;
    });
}
