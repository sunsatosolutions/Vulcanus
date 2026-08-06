import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { prettifyDirName } from "./dirname.js";
import { blockText, readJsonl } from "./jsonl.js";
import {
  cap,
  normalizeRole,
  MAX_MESSAGES_PER_CONVERSATION,
  type ImportAdapter,
  type NormalizedConversation,
  type NormalizedMessage,
} from "./types.js";

async function sessionFiles(root: string): Promise<Array<{ dir: string; file: string }>> {
  if (!existsSync(root)) return [];
  const out: Array<{ dir: string; file: string }> = [];
  const projectDirs = await readdir(root, { withFileTypes: true });

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const dir = resolve(root, projectDir.name);
    const files = await readdir(dir).catch(() => []);
    for (const file of files) {
      if (file.toLowerCase().endsWith(".jsonl")) out.push({ dir, file: resolve(dir, file) });
    }
  }
  return out;
}

/**
 * Claude Code names each project directory after the encoded working directory,
 * but the encoding is lossy for names containing dashes. The `cwd` recorded on
 * message lines is authoritative, so prefer it and fall back to the directory.
 */
function projectNameFrom(cwds: Set<string>, dir: string): string | undefined {
  if (cwds.size > 0) {
    const shortest = [...cwds].sort((a, b) => a.length - b.length)[0];
    const name = basename(shortest);
    if (name) return prettifyDirName(name);
  }
  const decoded = basename(dir).replace(/^-/, "").split("-").pop();
  return decoded ? prettifyDirName(decoded) : undefined;
}

export const claudeCodeAdapter: ImportAdapter = {
  id: "claude-code",
  label: "Claude Code local sessions",

  defaultPaths() {
    return [resolve(homedir(), ".claude/projects")];
  },

  async inspect(path) {
    const files = await sessionFiles(path);
    if (files.length === 0) return null;
    const projects = new Set(files.map((entry) => entry.dir)).size;
    return {
      source: "claude-code",
      path,
      detail: `${files.length} sessions across ${projects} working directories`,
    };
  },

  async *load(path) {
    for (const { dir, file } of await sessionFiles(path)) {
      const messages: NormalizedMessage[] = [];
      const cwds = new Set<string>();
      let title = "";
      let firstTimestamp: number | null = null;
      let lastTimestamp: number | null = null;

      for await (const entry of readJsonl(file)) {
        if (typeof entry.cwd === "string") cwds.add(entry.cwd);

        const timestamp =
          typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
        if (!Number.isNaN(timestamp)) {
          firstTimestamp ??= timestamp;
          lastTimestamp = timestamp;
        }

        if (entry.type === "custom-title" && typeof entry.customTitle === "string") {
          title = entry.customTitle;
        } else if (!title && entry.type === "ai-title" && typeof entry.aiTitle === "string") {
          title = entry.aiTitle;
        }

        if (entry.type !== "user" && entry.type !== "assistant") continue;
        if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) continue;

        const message = entry.message as { role?: string; content?: unknown } | undefined;
        if (!message) continue;
        const role = normalizeRole(message.role ?? entry.type);
        if (role === "other") continue;
        const text = cap(blockText(message.content));
        if (!text) continue;
        messages.push({ role, text });
      }

      if (messages.length === 0) continue;

      const group = projectNameFrom(cwds, dir);
      yield {
        id: basename(file, ".jsonl"),
        title:
          title ||
          messages.find((message) => message.role === "user")?.text.slice(0, 90) ||
          "(untitled session)",
        syntheticTitle: title === "",
        createdAt: firstTimestamp,
        updatedAt: lastTimestamp,
        source: "claude-code",
        group,
        messages,
      } satisfies NormalizedConversation;
    }
  },
};
