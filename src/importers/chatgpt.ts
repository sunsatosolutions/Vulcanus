import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import {
  cap,
  normalizeRole,
  MAX_MESSAGES_PER_CONVERSATION,
  type DetectedSource,
  type ImportAdapter,
  type NormalizedConversation,
  type NormalizedMessage,
} from "./types.js";

interface ChatGptMessage {
  author?: { role?: string };
  content?: { content_type?: string; parts?: unknown[] };
  create_time?: number | null;
}

interface ChatGptConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number | null;
  update_time?: number | null;
  mapping?: Record<string, { message?: ChatGptMessage | null }>;
}

/** ChatGPT splits large exports into conversations-000.json … conversations-NNN.json. */
async function conversationFiles(path: string): Promise<string[]> {
  const info = await stat(path).catch(() => null);
  if (!info) return [];

  if (info.isFile()) {
    return /conversations.*\.json$/i.test(basename(path)) ? [path] : [];
  }

  const entries = await readdir(path);
  return entries
    .filter((entry) => /^conversations(-\d+)?\.json$/i.test(entry))
    .sort()
    .map((entry) => resolve(path, entry));
}

function extractText(content: ChatGptMessage["content"]): string {
  if (!content?.parts) return "";
  const chunks: string[] = [];
  for (const part of content.parts) {
    if (typeof part === "string") {
      chunks.push(part);
    } else if (part && typeof part === "object" && "text" in part) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n");
}

function toNormalized(raw: ChatGptConversation, index: number): NormalizedConversation | null {
  const messages: NormalizedMessage[] = [];

  for (const node of Object.values(raw.mapping ?? {})) {
    const message = node?.message;
    if (!message) continue;
    const role = normalizeRole(message.author?.role);
    if (role === "other") continue;
    const text = cap(extractText(message.content));
    if (!text) continue;
    messages.push({ role, text });
    if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) break;
  }

  const title = (raw.title ?? "").trim();
  if (!title && messages.length === 0) return null;

  return {
    id: raw.id ?? raw.conversation_id ?? `chatgpt-${index}`,
    title: title || "(untitled)",
    createdAt: raw.create_time ? Math.round(raw.create_time * 1000) : null,
    updatedAt: raw.update_time ? Math.round(raw.update_time * 1000) : null,
    source: "chatgpt",
    messages,
  };
}

export const chatgptAdapter: ImportAdapter = {
  id: "chatgpt",
  label: "ChatGPT data export",

  defaultPaths() {
    const home = homedir();
    return [
      resolve(home, "Downloads"),
      resolve(process.cwd(), "_imports/chatgpt-export"),
      resolve(process.cwd(), "chatgpt-export"),
    ];
  },

  async inspect(path) {
    const files = await conversationFiles(path);
    if (files.length === 0) return null;
    const detail =
      files.length === 1 ? "1 conversation file" : `${files.length} conversation files`;
    return { source: "chatgpt", path, detail } satisfies DetectedSource;
  },

  async *load(path) {
    const files = await conversationFiles(path);
    let index = 0;

    for (const file of files) {
      if (!existsSync(file)) continue;
      const raw = await readFile(file, "utf8");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // A corrupt batch should not abort the whole import.
      }

      const conversations: ChatGptConversation[] = Array.isArray(parsed)
        ? (parsed as ChatGptConversation[])
        : Array.isArray((parsed as { conversations?: unknown }).conversations)
          ? (parsed as { conversations: ChatGptConversation[] }).conversations
          : [];

      for (const conversation of conversations) {
        const normalized = toNormalized(conversation, index++);
        if (normalized) yield normalized;
      }
    }
  },
};
