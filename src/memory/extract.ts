/**
 * Memory candidates: decisions and rules the operator already stated in their
 * conversations, proposed for review.
 *
 * Only the operator's own messages are read — an assistant's sentence is not
 * the operator's decision. Everything here is deterministic and local; the
 * output is a short, ranked list per project that a person reviews one item at
 * a time. Nothing in this module writes anywhere.
 */
import { isStopword } from "../importers/stopwords.js";
import type { ImportSourceId, NormalizedConversation } from "../importers/types.js";
import { classify, CUES, type Cue } from "./cues.js";
import { parseSections, type MemorySection } from "./lifecycle.js";

/** The review is meant to take minutes, not an afternoon. */
export const MAX_CANDIDATES_PER_PROJECT = 15;
export const MIN_WORDS = 4;
export const MAX_WORDS = 40;
/** Token-set Jaccard at which two sentences are the same statement. */
export const SAME_STATEMENT = 0.6;
/** Share of a candidate's words an existing section must cover to make it known. */
export const KNOWN_COVERAGE = 0.7;
/** Coverage at which a candidate may be revising an existing section. */
export const REPLACES_COVERAGE = 0.35;
/** A correction cue lowers the bar for the "may replace" hint. */
export const REPLACES_COVERAGE_CORRECTION = 0.25;
/** A single weight-1 mention scores below this; a repeated one clears it. */
export const MIN_SCORE = 3;

const DAY = 24 * 60 * 60 * 1000;

export interface SentenceHit {
  /** Stable within a run: `<conversation id>#<n>`. */
  id: string;
  conversationId: string;
  source: ImportSourceId;
  project: string;
  kind: "decision" | "rule";
  weight: number;
  correction: boolean;
  text: string;
  time: number | null;
}

export interface MemoryCandidate {
  /** Stable within a run, e.g. `c3`. */
  id: string;
  project: string;
  kind: "decision" | "rule";
  /** The most recent wording of the statement. */
  text: string;
  correction: boolean;
  score: number;
  /** Distinct conversations the statement appears in. */
  conversations: number;
  lastSeen: number | null;
  sources: ImportSourceId[];
  /** Every source sentence merged into this candidate. */
  sentenceIds: string[];
  /** An existing live section this candidate may be revising. */
  replaces?: { heading: string; path: string; overlap: number };
}

/** Same folding the project-name analysis uses, so Turkish i variants agree. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/̇/g, "")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokens(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(" ")
      .filter((token) => token.length > 2 && !isStopword(token)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Share of `a`'s tokens that also appear in `b`. */
export function coverage(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / a.size;
}

const CODE_LIKE = /[{};]|=>|\(\)|<\/?[a-z]+>|^\s*[$>]/i;

/**
 * Sentences worth classifying. Code blocks are dropped outright; inline code
 * keeps its text, since "we use `pnpm`" is a decision about pnpm. Questions,
 * fragments, and walls of text are not statements.
 */
export function sentencesOf(text: string): string[] {
  const prose = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    // Importers collapse whitespace, so a Markdown heading arrives glued to the
    // sentence after it; dropping the marker keeps that sentence usable.
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return prose
    .split(/(?<=[.!?…])\s+|\s+(?:[-•*]|\d+[.)])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence || sentence.endsWith("?")) return false;
      if (CODE_LIKE.test(sentence)) return false;
      const words = sentence.split(" ").length;
      return words >= MIN_WORDS && words <= MAX_WORDS;
    });
}

/** Decision and rule statements in one conversation's user messages. */
export function hitsIn(
  conversation: NormalizedConversation,
  project: string,
  cues: Cue[] = CUES,
): SentenceHit[] {
  const hits: SentenceHit[] = [];
  let n = 0;
  for (const message of conversation.messages) {
    if (message.role !== "user") continue;
    for (const sentence of sentencesOf(message.text)) {
      n += 1;
      const match = classify(sentence, cues);
      if (!match) continue;
      hits.push({
        id: `${conversation.id}#${n}`,
        conversationId: conversation.id,
        source: conversation.source,
        project,
        kind: match.kind,
        weight: match.weight,
        correction: match.correction,
        text: sentence,
        time: conversation.updatedAt ?? conversation.createdAt,
      });
    }
  }
  return hits;
}

function recency(lastSeen: number | null, now: number): number {
  if (lastSeen === null) return 0;
  const age = (now - lastSeen) / DAY;
  if (age <= 30) return 1;
  if (age <= 180) return 0.5;
  return 0;
}

/**
 * Merge restatements of the same sentence, score each statement, and keep
 * the strongest per project. Repetition across conversations is the strongest
 * signal: a decision restated in five conversations is one the operator lives
 * by.
 */
export function rankCandidates(hits: SentenceHit[], now: number = Date.now()): MemoryCandidate[] {
  interface Cluster {
    project: string;
    tokens: Set<string>;
    hits: SentenceHit[];
  }
  const clusters: Cluster[] = [];

  for (const hit of hits) {
    const hitTokens = tokens(hit.text);
    if (hitTokens.size === 0) continue;
    const home = clusters.find(
      (cluster) =>
        cluster.project === hit.project && jaccard(cluster.tokens, hitTokens) >= SAME_STATEMENT,
    );
    if (home) home.hits.push(hit);
    else clusters.push({ project: hit.project, tokens: hitTokens, hits: [hit] });
  }

  const scored = clusters.map((cluster) => {
    const latest = [...cluster.hits].sort(
      (a, b) => (b.time ?? 0) - (a.time ?? 0) || b.weight - a.weight,
    )[0];
    const strongest = cluster.hits.reduce((best, hit) => (hit.weight > best.weight ? hit : best));
    const conversations = new Set(cluster.hits.map((hit) => hit.conversationId)).size;
    const times = cluster.hits
      .map((hit) => hit.time)
      .filter((time): time is number => time !== null);
    const lastSeen = times.length ? Math.max(...times) : null;
    const score = strongest.weight + 2 * Math.log2(conversations) + recency(lastSeen, now);
    return {
      project: cluster.project,
      kind: strongest.kind,
      text: latest.text,
      correction: cluster.hits.some((hit) => hit.correction),
      score: Math.round(score * 100) / 100,
      conversations,
      lastSeen,
      sources: [...new Set(cluster.hits.map((hit) => hit.source))],
      sentenceIds: cluster.hits.map((hit) => hit.id),
    };
  });

  const kept: MemoryCandidate[] = [];
  const perProject = new Map<string, number>();
  scored
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .forEach((candidate) => {
      const count = perProject.get(candidate.project) ?? 0;
      if (count >= MAX_CANDIDATES_PER_PROJECT) return;
      perProject.set(candidate.project, count + 1);
      kept.push({ id: `c${kept.length + 1}`, ...candidate });
    });
  return kept;
}

export interface ExistingSection {
  section: MemorySection;
  kind: "decision" | "rule";
  tokens: Set<string>;
  live: boolean;
}

/** A Decisions or Rules note, read into sections a candidate can be checked against. */
export function existingSections(
  path: string,
  text: string,
  kind: "decision" | "rule",
  isLive: (section: MemorySection) => boolean,
): ExistingSection[] {
  const lines = text.split(/\r?\n/);
  return parseSections(path, text).map((section) => ({
    section,
    kind,
    // Sub-headings such as "### Decision" are template, not content.
    tokens: tokens(
      lines
        .slice(section.line - 1, section.endLine)
        .filter((line) => !/^#{3,6}\s/.test(line))
        .join(" "),
    ),
    live: isLive(section),
  }));
}

/**
 * Drop candidates the vault already records, and point the rest at a live
 * section they may be revising. A restatement of a superseded decision is
 * dropped too: it is the old message, not new memory.
 */
export function compareWithVault(
  candidates: MemoryCandidate[],
  sectionsByProject: Map<string, ExistingSection[]>,
): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  for (const candidate of candidates) {
    const own = tokens(candidate.text);
    const sections = sectionsByProject.get(candidate.project) ?? [];
    if (sections.some((entry) => coverage(own, entry.tokens) >= KNOWN_COVERAGE)) continue;

    const bar = candidate.correction ? REPLACES_COVERAGE_CORRECTION : REPLACES_COVERAGE;
    let best: MemoryCandidate["replaces"];
    for (const entry of sections) {
      if (!entry.live || entry.kind !== candidate.kind) continue;
      const overlap = coverage(own, entry.tokens);
      if (overlap >= bar && (!best || overlap > best.overlap)) {
        best = {
          heading: entry.section.heading,
          path: entry.section.path,
          overlap: Math.round(overlap * 100) / 100,
        };
      }
    }
    out.push(best ? { ...candidate, replaces: best } : candidate);
  }
  return out;
}

/**
 * A heading for an accepted candidate: its opening words, without trailing
 * punctuation. The operator can rename it in review.
 */
export function suggestTitle(text: string, taken: Set<string> = new Set()): string {
  const words = text
    .replace(/[.!…:;,]+$/u, "")
    .replace(/[[\]|#^]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const head = words.slice(0, 7).join(" ");
  const base = head.charAt(0).toLocaleUpperCase() + head.slice(1);
  let title = base || "Imported decision";
  for (let n = 2; taken.has(title.toLowerCase()); n += 1) title = `${base} (${n})`;
  return title;
}
