import { jsonListIn, runHeadless, type DetectedCli, type Exec } from "./clis.js";
import type { AnalysisResult, ProjectCandidate } from "../importers/analyze.js";
import type { NormalizedConversation } from "../importers/types.js";

/**
 * Ask an installed AI CLI to group conversations into projects.
 *
 * The word-frequency pass proposes names that repeat; it cannot tell that
 * "the studio site" and "Lumé" are one project, and it cannot ignore a name
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

/** The clusters in a model's reply; null when it holds no `projects` list. */
export function parseClusters(output: string): AiCluster[] | null {
  const projects = jsonListIn(output, "projects");
  if (!projects) return null;

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

export interface ClusterRun {
  clusters: AiCluster[] | null;
  /** Why nothing came back, for a message the operator can act on. */
  error?: string;
}

export async function runClustering(
  cli: DetectedCli,
  digest: DigestEntry[],
  exec?: Exec,
): Promise<ClusterRun> {
  if (digest.length === 0) return { clusters: [] };

  try {
    const stdout = await runHeadless(cli, buildClusterPrompt(digest), CLUSTER_TIMEOUT_MS, exec);
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
