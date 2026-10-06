import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchCommand, type DetectedCli } from "./clis.js";
import type { MemoryCandidate } from "../memory/extract.js";

const run = promisify(execFile);

/**
 * Ask an installed AI CLI to tidy the memory candidates the heuristic found.
 *
 * Opt-in, and never silent — the same contract as grouping. What is sent is the
 * candidate sentences themselves, already reduced by the local pass, never a
 * transcript. The model may re-rank, merge, drop, and rephrase; it may not
 * invent. Every candidate it returns must name the source candidates it came
 * from, and one that names none, or names an id that was never sent, is
 * discarded rather than trusted.
 */

export const EXTRACT_TIMEOUT_MS = 120_000;

export interface ExtractDigestEntry {
  id: string;
  project: string;
  kind: "decision" | "rule";
  text: string;
}

export interface ExtractedEntry {
  from: string[];
  kind: "decision" | "rule";
  text: string;
}

export function buildExtractDigest(candidates: MemoryCandidate[]): ExtractDigestEntry[] {
  return candidates.map(({ id, project, kind, text }) => ({ id, project, kind, text }));
}

export function buildExtractPrompt(digest: ExtractDigestEntry[]): string {
  return [
    "Below are sentences a person wrote in past AI conversations, each flagged as a",
    "possible decision or standing rule about one of their projects.",
    "",
    "Return JSON and nothing else, in exactly this shape:",
    '{"candidates":[{"from":["c1","c4"],"kind":"decision","text":"..."}]}',
    "",
    "Rules:",
    "- Keep only real decisions (a choice that was made) and rules (a standing",
    "  constraint). Drop requests, complaints, and one-off instructions.",
    "- Merge entries that state the same thing; list every merged id in `from`.",
    "- `text` is one clear sentence in the language the person wrote in. Do not",
    "  add facts that are not in the source sentences.",
    "- Never put two projects' entries in one candidate.",
    "- Order by how durable and important the statement is, most first.",
    '- If nothing qualifies, return {"candidates":[]}.',
    "",
    "Entries:",
    ...digest.map((entry) => `${entry.id} | ${entry.project} | ${entry.kind} | ${entry.text}`),
  ].join("\n");
}

/** Pull the JSON object out of a model's reply; null when there is none. */
export function parseExtracted(output: string): ExtractedEntry[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
  const sources = [fenced?.[1], output].filter((value): value is string => Boolean(value));

  for (const source of sources) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(source.slice(start, end + 1));
    } catch {
      continue;
    }
    const list = (parsed as { candidates?: unknown })?.candidates;
    if (!Array.isArray(list)) continue;

    const entries: ExtractedEntry[] = [];
    for (const item of list) {
      const from = (item as { from?: unknown })?.from;
      const kind = (item as { kind?: unknown })?.kind;
      const text = (item as { text?: unknown })?.text;
      if (!Array.isArray(from) || typeof text !== "string" || !text.trim()) continue;
      if (kind !== "decision" && kind !== "rule") continue;
      entries.push({
        from: from.filter((id): id is string => typeof id === "string"),
        kind,
        text: text.trim(),
      });
    }
    return entries;
  }
  return null;
}

/**
 * Rebuild the candidate list from the model's answer. Evidence is carried over
 * from the source candidates, never taken from the model: counts are counted.
 */
export function applyExtracted(
  candidates: MemoryCandidate[],
  entries: ExtractedEntry[],
): MemoryCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const used = new Set<string>();
  const out: MemoryCandidate[] = [];

  for (const entry of entries) {
    const sources = [...new Set(entry.from)].map((id) => byId.get(id));
    if (sources.length === 0 || sources.some((source) => !source)) continue;
    const known = sources as MemoryCandidate[];
    if (known.some((source) => used.has(source.id))) continue;
    if (new Set(known.map((source) => source.project)).size > 1) continue;

    known.forEach((source) => used.add(source.id));
    const lead = known.reduce((best, source) => (source.score > best.score ? source : best));
    out.push({
      ...lead,
      kind: entry.kind,
      text: entry.text,
      correction: known.some((source) => source.correction),
      score: Math.max(...known.map((source) => source.score)),
      conversations: Math.max(...known.map((source) => source.conversations)),
      lastSeen: Math.max(...known.map((source) => source.lastSeen ?? 0)) || null,
      sources: [...new Set(known.flatMap((source) => source.sources))],
      sentenceIds: known.flatMap((source) => source.sentenceIds),
      replaces: known.find((source) => source.replaces)?.replaces,
    });
  }
  return out;
}

export interface ExtractRun {
  entries: ExtractedEntry[] | null;
  error?: string;
}

export async function runExtraction(
  cli: DetectedCli,
  digest: ExtractDigestEntry[],
  exec: typeof run = run,
): Promise<ExtractRun> {
  if (digest.length === 0) return { entries: [] };
  try {
    const launch = launchCommand(cli.path, cli.printArgs(buildExtractPrompt(digest)));
    const { stdout } = await exec(launch.command, launch.args, {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const entries = parseExtracted(stdout);
    return entries ? { entries } : { entries: null, error: "no JSON in the reply" };
  } catch (error) {
    return { entries: null, error: (error as Error).message };
  }
}
