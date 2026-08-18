import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DetectedCli } from "./clis.js";
import type { AnalysisResult, ProjectCandidate } from "../importers/analyze.js";
import type { NormalizedConversation } from "../importers/types.js";

const run = promisify(execFile);

/**
 * Ask an installed AI CLI to group conversations into projects.
 *
 * The word-frequency pass proposes names that repeat; it cannot tell that
 * "the roastery site" and "Nué" are one project, and it cannot ignore a name
 * that repeats for a reason that is not a project. A model reading the titles
 * can do both, so this runs alongside the heuristic rather than instead of it:
 * the heuristic still supplies the evidence counts, and grouping only adds
 * names or merges ones it can justify.
 *
 * Opt-in, and never silent. What is sent is a digest — titles, any grouping the
 * source already supplied, and one short opening line per conversation — never
 * whole transcripts. The operator is told what leaves the machine before it
 * does, because "a locally installed CLI" is not the same as "local": most of
 * them are a front end for a hosted model.
 */

/** How many conversations are described to the model in one prompt. */
export const MAX_DIGEST_CONVERSATIONS = 400;
/** How much of a conversation's opening line is included. */
export const MAX_DIGEST_LINE = 160;
/** A model that has not answered by now is not going to. */
export const CLUSTER_TIMEOUT_MS = 120_000;

export interface DigestEntry {
  id: string;
  title: string;
  group?: string;
  opening?: string;
}

export interface AiCluster {
  name: string;
  conversationIds: string[];
}

/** Everything the model is shown, so a caller can print it before sending. */
export function buildDigest(conversations: NormalizedConversation[]): DigestEntry[] {
  const digest: DigestEntry[] = [];
  for (const conversation of conversations.slice(0, MAX_DIGEST_CONVERSATIONS)) {
    const opening = conversation.messages.find((message) => message.role === "user")?.text;
    digest.push({
      id: conversation.id,
      title: conversation.syntheticTitle ? "" : conversation.title,
      ...(conversation.group ? { group: conversation.group } : {}),
      ...(opening ? { opening: opening.replace(/\s+/g, " ").slice(0, MAX_DIGEST_LINE) } : {}),
    });
  }
  return digest;
}

export function buildClusterPrompt(digest: DigestEntry[]): string {
  return [
    "You are grouping a developer's AI conversation history into the projects it is about.",
    "",
    "Each line below is one conversation: an id, its title, the grouping its source",
    "already recorded (if any), and the opening words of the first message.",
    "",
    "Return JSON and nothing else, in exactly this shape:",
    '{"projects":[{"name":"Project Name","conversationIds":["id1","id2"]}]}',
    "",
    "Rules:",
    "- A project is something the person builds, runs, or is hired for. Not a topic,",
    "  not a technology, not a question they asked once.",
    "- Merge conversations that are about the same project under different words.",
    "- Use the name the person would recognize, capitalized as they write it.",
    "- Leave a conversation out entirely rather than forcing it into a project.",
    '- If nothing in the list is a project, return {"projects":[]}.',
    "",
    "Conversations:",
    ...digest.map((entry) =>
      [
        entry.id,
        entry.title || "(untitled)",
        entry.group ? `[${entry.group}]` : "",
        entry.opening ? `— ${entry.opening}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    ),
  ].join("\n");
}

/**
 * Pull the JSON object out of a model's reply.
 *
 * Models wrap JSON in prose or a fenced block often enough that demanding a
 * bare object would fail on answers that are otherwise correct. Anything that
 * is not a well-formed object of the expected shape returns null, and the
 * caller falls back to the heuristic rather than guessing.
 */
export function parseClusters(output: string): AiCluster[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
  const candidates = [fenced?.[1], output].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }

    const projects = (parsed as { projects?: unknown })?.projects;
    if (!Array.isArray(projects)) continue;

    const clusters: AiCluster[] = [];
    for (const entry of projects) {
      const name = (entry as { name?: unknown })?.name;
      const ids = (entry as { conversationIds?: unknown })?.conversationIds;
      if (typeof name !== "string" || !name.trim()) continue;
      clusters.push({
        name: name.trim(),
        conversationIds: Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : [],
      });
    }
    return clusters;
  }

  return null;
}

export interface ClusterRun {
  clusters: AiCluster[] | null;
  /** Why nothing came back, for a message the operator can act on. */
  error?: string;
}

export async function runClustering(
  cli: DetectedCli,
  digest: DigestEntry[],
  exec: typeof run = run,
): Promise<ClusterRun> {
  if (digest.length === 0) return { clusters: [] };

  try {
    const { stdout } = await exec(cli.path, cli.printArgs(buildClusterPrompt(digest)), {
      timeout: CLUSTER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const clusters = parseClusters(stdout);
    return clusters ? { clusters } : { clusters: null, error: "no JSON in the reply" };
  } catch (error) {
    return { clusters: null, error: (error as Error).message };
  }
}

function foldKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Fold the model's grouping into the heuristic result.
 *
 * The heuristic keeps its evidence — conversation counts are counted, not
 * judged. A cluster that matches an existing candidate promotes it, because two
 * independent methods agreeing is the strongest signal available. A cluster the
 * heuristic missed is added at `medium` at best: the model proposed it, nothing
 * corroborated it, and an import that silently promotes a guess to `high` is
 * how a vault gains a project nobody works on.
 */
export function mergeClusters(analysis: AnalysisResult, clusters: AiCluster[]): AnalysisResult {
  const byKey = new Map(
    analysis.candidates.map((candidate) => [foldKey(candidate.name), candidate]),
  );
  const merged: ProjectCandidate[] = [...analysis.candidates];

  for (const cluster of clusters) {
    const key = foldKey(cluster.name);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.confidence = existing.confidence === "low" ? "medium" : "high";
      continue;
    }

    const conversations = cluster.conversationIds.length;
    if (conversations === 0) continue;

    const candidate: ProjectCandidate = {
      name: cluster.name,
      score: conversations,
      confidence: conversations >= 3 ? "medium" : "low",
      evidence: {
        conversations,
        titleHits: 0,
        bodyHits: 0,
        explicitGroup: false,
        firstSeen: null,
        lastSeen: null,
        sampleTitles: [],
        sources: [],
      },
    };
    merged.push(candidate);
    byKey.set(key, candidate);
  }

  merged.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ...analysis, candidates: merged };
}
