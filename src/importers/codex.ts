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

/** Codex nests rollout files under sessions/YYYY/MM/DD and archived_sessions. */
async function rolloutFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        out.push(full);
      }
    }
  };

  await walk(root, 0);
  return out;
}

function candidateRoots(path: string): string[] {
  const base = basename(path);
  if (base === "sessions" || base === "archived_sessions") return [path];
  return [resolve(path, "sessions"), resolve(path, "archived_sessions")].filter((dir) =>
    existsSync(dir),
  );
}

export const codexAdapter: ImportAdapter = {
  id: "codex",
  label: "Codex local sessions",

  defaultPaths() {
    return [resolve(homedir(), ".codex")];
  },

  async inspect(path) {
    const roots = candidateRoots(path);
    if (roots.length === 0) return null;
    let count = 0;
    for (const root of roots) count += (await rolloutFiles(root)).length;
    if (count === 0) return null;
    return { source: "codex", path, detail: `${count} rollout sessions` };
  },

  async *load(path) {
    for (const root of candidateRoots(path)) {
      for (const file of await rolloutFiles(root)) {
        const messages: NormalizedMessage[] = [];
        let cwd: string | undefined;
        let firstTimestamp: number | null = null;
        let lastTimestamp: number | null = null;

        for await (const entry of readJsonl(file)) {
          const timestamp =
            typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
          if (!Number.isNaN(timestamp)) {
            firstTimestamp ??= timestamp;
            lastTimestamp = timestamp;
          }

          const payload = entry.payload as Record<string, unknown> | undefined;
          if (!payload) continue;

          if (entry.type === "session_meta" && typeof payload.cwd === "string") {
            cwd = payload.cwd;
            continue;
          }

          if (entry.type !== "response_item") continue;
          if (payload.type !== "message") continue;
          if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) continue;

          const role = normalizeRole(payload.role as string | undefined);
          if (role === "other") continue;
          const text = cap(blockText(payload.content));
          if (!text) continue;
          messages.push({ role, text });
        }

        if (messages.length === 0) continue;

        yield {
          id: basename(file, ".jsonl"),
          title: messages.find((message) => message.role === "user")?.text.slice(0, 90) ?? "(untitled session)",
          syntheticTitle: true,
          createdAt: firstTimestamp,
          updatedAt: lastTimestamp,
          source: "codex",
          group: cwd ? prettifyDirName(basename(cwd)) : undefined,
          messages,
        } satisfies NormalizedConversation;
      }
    }
  },
};
