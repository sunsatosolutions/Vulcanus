import { isStopword } from "./stopwords.js";
import type { NormalizedConversation } from "./types.js";

export interface CandidateEvidence {
  /** Distinct conversations that mention this name anywhere. */
  conversations: number;
  titleHits: number;
  bodyHits: number;
  /** The source itself grouped conversations under this name. */
  explicitGroup: boolean;
  firstSeen: number | null;
  lastSeen: number | null;
  sampleTitles: string[];
  sources: string[];
}

export type Confidence = "high" | "medium" | "low";

export interface ProjectCandidate {
  name: string;
  score: number;
  confidence: Confidence;
  evidence: CandidateEvidence;
}

export interface AnalysisResult {
  conversations: number;
  sources: Record<string, number>;
  candidates: ProjectCandidate[];
}

const CAPITALIZED_PHRASE =
  /[A-ZÇĞİÖŞÜ][\p{L}\p{N}'’&.-]*(?:[ ][A-ZÇĞİÖŞÜ][\p{L}\p{N}'’&.-]*){0,2}/gu;

/**
 * Locale-independent folding key. Turkish casing would split "ARIA" (→ "arıa")
 * from "Aria", so dotted/dotless i is normalized to a single form before the
 * name is used as a map key.
 */
function key(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/̇/g, "")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function acceptable(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 40) return false;
  if (/^\d+$/.test(trimmed)) return false;

  // A working directory named after a sentence ("just-circling-back-to-this")
  // is a scratch folder, not a project.
  if ((trimmed.match(/[-_]/g) ?? []).length >= 3) return false;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 4) return false;
  if (tokens.every((token) => isStopword(token))) return false;
  // A multi-word phrase whose first word is a stopword is usually a sentence start.
  if (tokens.length > 1 && isStopword(tokens[0])) return false;
  if (tokens.length === 1 && isStopword(tokens[0])) return false;
  return true;
}

/** Capitalized 1–3 word phrases, plus their leading word as a shorter candidate. */
function phrasesFromTitle(title: string): string[] {
  const found = new Set<string>();
  for (const match of title.matchAll(CAPITALIZED_PHRASE)) {
    const phrase = match[0].replace(/[.\s]+$/, "").trim();
    if (acceptable(phrase)) found.add(phrase);
    const head = phrase.split(/\s+/)[0];
    if (head !== phrase && acceptable(head)) found.add(head);
  }
  return [...found];
}

interface Accumulator {
  display: Map<string, number>;
  conversations: Set<string>;
  titleHits: number;
  bodyHits: number;
  explicitGroup: boolean;
  /** Casing taken from the source's own grouping, which is authoritative. */
  groupDisplay: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  sampleTitles: string[];
  sources: Set<string>;
}

function accumulator(): Accumulator {
  return {
    display: new Map(),
    conversations: new Set(),
    titleHits: 0,
    bodyHits: 0,
    explicitGroup: false,
    groupDisplay: null,
    firstSeen: null,
    lastSeen: null,
    sampleTitles: [],
    sources: new Set(),
  };
}

function record(entry: Accumulator, display: string, conversation: NormalizedConversation): void {
  entry.display.set(display, (entry.display.get(display) ?? 0) + 1);
  entry.conversations.add(conversation.id);
  entry.sources.add(conversation.source);

  const stamp = conversation.updatedAt ?? conversation.createdAt;
  if (stamp !== null) {
    entry.firstSeen = entry.firstSeen === null ? stamp : Math.min(entry.firstSeen, stamp);
    entry.lastSeen = entry.lastSeen === null ? stamp : Math.max(entry.lastSeen, stamp);
  }
  if (entry.sampleTitles.length < 5 && !entry.sampleTitles.includes(conversation.title)) {
    entry.sampleTitles.push(conversation.title);
  }
}

function preferredDisplay(entry: Accumulator): string {
  if (entry.groupDisplay) return entry.groupDisplay;
  let best = "";
  let bestCount = -1;
  for (const [display, count] of entry.display) {
    if (count > bestCount || (count === bestCount && display.length > best.length)) {
      best = display;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Two passes over the conversation stream:
 *
 * 1. Titles and source-supplied groups propose candidate names. Free text is not
 *    mined for new names — that produces far too much noise.
 * 2. User message bodies only strengthen names already proposed in pass 1.
 */
export async function analyzeConversations(
  stream: () => AsyncIterable<NormalizedConversation>,
): Promise<AnalysisResult> {
  const entries = new Map<string, Accumulator>();
  const sources: Record<string, number> = {};
  let conversations = 0;

  const touch = (name: string): Accumulator => {
    const id = key(name);
    let entry = entries.get(id);
    if (!entry) {
      entry = accumulator();
      entries.set(id, entry);
    }
    return entry;
  };

  for await (const conversation of stream()) {
    conversations += 1;
    sources[conversation.source] = (sources[conversation.source] ?? 0) + 1;

    if (conversation.group && acceptable(conversation.group)) {
      const entry = touch(conversation.group);
      entry.explicitGroup = true;
      entry.groupDisplay ??= conversation.group;
      record(entry, conversation.group, conversation);
    }

    if (conversation.syntheticTitle) continue;

    for (const phrase of phrasesFromTitle(conversation.title)) {
      const entry = touch(phrase);
      entry.titleHits += 1;
      record(entry, phrase, conversation);
    }
  }

  // Drop the long tail before the (more expensive) body pass.
  for (const [id, entry] of entries) {
    if (!entry.explicitGroup && entry.conversations.size < 2) entries.delete(id);
  }

  const lookup = new Map<string, string>();
  for (const id of entries.keys()) lookup.set(id, id);
  const maxWords = Math.max(1, ...[...entries.keys()].map((id) => id.split(" ").length));

  for await (const conversation of stream()) {
    const seen = new Set<string>();
    for (const message of conversation.messages) {
      if (message.role !== "user") continue;
      const tokens = key(message.text).split(" ").filter(Boolean);
      for (let index = 0; index < tokens.length; index += 1) {
        for (let size = 1; size <= maxWords && index + size <= tokens.length; size += 1) {
          const gram = tokens.slice(index, index + size).join(" ");
          if (lookup.has(gram)) seen.add(gram);
        }
      }
    }
    for (const id of seen) {
      const entry = entries.get(id);
      if (!entry) continue;
      entry.bodyHits += 1;
      entry.conversations.add(conversation.id);
      entry.sources.add(conversation.source);
    }
  }

  const now = Date.now();
  const candidates: ProjectCandidate[] = [];

  for (const entry of entries.values()) {
    const name = preferredDisplay(entry);
    if (!name) continue;

    // A name someone actually *titles* conversations after is a project. A word
    // that only ever shows up mid-sentence is vocabulary, however often it
    // appears — so body mentions are capped support, never the main signal.
    if (!entry.explicitGroup) {
      if (entry.titleHits < 2) continue;
      const titleShare = entry.titleHits / (entry.titleHits + entry.bodyHits);
      if (titleShare < 0.1) continue;
    }

    const recencyDays =
      entry.lastSeen === null ? 365 : Math.max(0, (now - entry.lastSeen) / 86_400_000);
    const recencyBonus = recencyDays < 30 ? 8 : recencyDays < 120 ? 4 : 0;

    const bodySupport = Math.min(entry.bodyHits, 25) * 0.6;
    // Volume breaks ties between equally-confident names so the list reads
    // "most-worked-on first" rather than alphabetically.
    const volume = Math.min(entry.conversations.size, 100) * 0.2;
    const score =
      (entry.explicitGroup ? 60 : 0) + entry.titleHits * 6 + bodySupport + volume + recencyBonus;

    const confidence: Confidence =
      entry.explicitGroup || entry.titleHits >= 8
        ? "high"
        : entry.titleHits >= 3
          ? "medium"
          : "low";

    candidates.push({
      name,
      score: Math.round(score * 10) / 10,
      confidence,
      evidence: {
        conversations: entry.conversations.size,
        titleHits: entry.titleHits,
        bodyHits: entry.bodyHits,
        explicitGroup: entry.explicitGroup,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        sampleTitles: entry.sampleTitles,
        sources: [...entry.sources],
      },
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return { conversations, sources, candidates };
}
