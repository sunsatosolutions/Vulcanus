import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import {
  cap,
  normalizeRole,
  MAX_MESSAGES_PER_CONVERSATION,
  type ImportAdapter,
  type NormalizedConversation,
  type NormalizedMessage,
} from "./types.js";

interface ClaudeContentBlock {
  type?: string;
  text?: string;
}

interface ClaudeMessage {
  sender?: string;
  role?: string;
  text?: string;
  content?: ClaudeContentBlock[] | string;
  created_at?: string;
}

interface ClaudeConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  project_uuid?: string;
  project?: { uuid?: string; name?: string };
  chat_messages?: ClaudeMessage[];
}

interface ClaudeProject {
  uuid?: string;
  name?: string;
}

function resolveFiles(path: string): { conversations: string; projects: string } | null {
  if (!existsSync(path)) return null;
  const isFile = basename(path).toLowerCase().endsWith(".json");
  const dir = isFile ? dirname(path) : path;
  const conversations = isFile ? path : resolve(dir, "conversations.json");
  if (!existsSync(conversations)) return null;
  return { conversations, projects: resolve(dir, "projects.json") };
}

function messageText(message: ClaudeMessage): string {
  if (typeof message.text === "string" && message.text.trim()) return cap(message.text);
  if (typeof message.content === "string") return cap(message.content);
  if (Array.isArray(message.content)) {
    const chunks = message.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string);
    return cap(chunks.join("\n"));
  }
  return "";
}

function toEpoch(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export const claudeExportAdapter: ImportAdapter = {
  id: "claude",
  label: "Claude.ai data export",

  defaultPaths() {
    const home = homedir();
    return [
      resolve(home, "Downloads"),
      resolve(process.cwd(), "_imports/claude-export"),
      resolve(process.cwd(), "claude-export"),
    ];
  },

  async inspect(path) {
    const files = resolveFiles(path);
    if (!files) return null;
    const info = await stat(files.conversations).catch(() => null);
    if (!info) return null;
    const size = `${Math.max(1, Math.round(info.size / 1024))} KB`;
    const withProjects = existsSync(files.projects) ? ", projects.json present" : "";
    return { source: "claude", path, detail: `conversations.json (${size})${withProjects}` };
  },

  async *load(path) {
    const files = resolveFiles(path);
    if (!files) return;

    const projectNames = new Map<string, string>();
    if (existsSync(files.projects)) {
      try {
        const parsed = JSON.parse(await readFile(files.projects, "utf8")) as ClaudeProject[];
        for (const project of parsed) {
          if (project.uuid && project.name) projectNames.set(project.uuid, project.name);
        }
      } catch {
        // A missing or malformed projects.json only costs us the grouping signal.
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(files.conversations, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;

    let index = 0;
    for (const raw of parsed as ClaudeConversation[]) {
      const messages: NormalizedMessage[] = [];
      for (const message of raw.chat_messages ?? []) {
        const role = normalizeRole(message.sender ?? message.role);
        if (role === "other") continue;
        const text = messageText(message);
        if (!text) continue;
        messages.push({ role, text });
        if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) break;
      }

      const title = (raw.name ?? "").trim();
      if (!title && messages.length === 0) continue;

      const projectUuid = raw.project_uuid ?? raw.project?.uuid;
      const group = raw.project?.name ?? (projectUuid ? projectNames.get(projectUuid) : undefined);

      yield {
        id: raw.uuid ?? `claude-${index++}`,
        title: title || "(untitled)",
        createdAt: toEpoch(raw.created_at),
        updatedAt: toEpoch(raw.updated_at),
        source: "claude",
        group,
        messages,
      };
    }
  },
};
