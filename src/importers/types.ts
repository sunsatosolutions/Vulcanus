export type ImportSourceId = "chatgpt" | "claude" | "claude-code" | "codex";

export type MessageRole = "user" | "assistant" | "other";

export interface NormalizedMessage {
  role: MessageRole;
  text: string;
}

export interface NormalizedConversation {
  id: string;
  title: string;
  /** Epoch milliseconds, when the source provides a timestamp. */
  createdAt: number | null;
  updatedAt: number | null;
  source: ImportSourceId;
  /**
   * An explicit grouping supplied by the source itself — a Claude project name,
   * or the working directory a coding session ran in. This is the strongest
   * available project signal and is trusted above any text heuristic.
   */
  group?: string;
  /**
   * True when the source has no real title and one was synthesized from the
   * first message. Coding sessions work this way, and mining those pseudo-titles
   * for project names just surfaces prompt boilerplate — for those sources the
   * working directory is the project signal.
   */
  syntheticTitle?: boolean;
  messages: NormalizedMessage[];
}

export interface DetectedSource {
  source: ImportSourceId;
  path: string;
  /** Human-readable hint shown in the wizard, e.g. "16 conversation files". */
  detail: string;
}

export interface ImportAdapter {
  id: ImportSourceId;
  label: string;
  /** Locations probed automatically when the user does not supply a path. */
  defaultPaths(): string[];
  /** Confirm a path really holds this kind of export, and describe it. */
  inspect(path: string): Promise<DetectedSource | null>;
  /** Stream conversations so large exports never load fully into memory. */
  load(path: string): AsyncGenerator<NormalizedConversation>;
}

/** Messages are capped before analysis; nothing needs full transcripts. */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_MESSAGES_PER_CONVERSATION = 40;

export function cap(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_MESSAGE_CHARS ? collapsed.slice(0, MAX_MESSAGE_CHARS) : collapsed;
}

export function normalizeRole(role: string | undefined): MessageRole {
  if (role === "user" || role === "human") return "user";
  if (role === "assistant") return "assistant";
  return "other";
}
