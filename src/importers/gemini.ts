import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import {
  cap,
  normalizeRole,
  MAX_MESSAGES_PER_CONVERSATION,
  type ImportAdapter,
  type NormalizedConversation,
  type NormalizedMessage,
} from "./types.js";

/**
 * Gemini CLI keeps its per-project state under `~/.gemini/tmp/<hash>/`, where
 * the hash is derived from the working directory and cannot be reversed — so
 * unlike the Claude Code and Codex importers, there is no directory name to
 * read a project out of.
 *
 * Two kinds of file live there:
 *
 * - `logs.json` — the rolling prompt log. Entries carry no title, so these
 *   become synthetic-titled conversations: they never propose a project name on
 *   their own, but they do strengthen names proposed elsewhere.
 * - `checkpoint-<tag>.json` — a conversation the operator saved under a name
 *   with `/chat save`. That tag *is* a deliberate label, so it is used as the
 *   title and treated as a real naming signal.
 *
 * The shapes have changed between Gemini CLI releases, so every field is read
 * defensively and anything unrecognized is skipped rather than throwing.
 */

interface SessionFile {
  path: string;
  /** Tag from `checkpoint-<tag>.json`, when the operator named the session. */
  tag: string | null;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as { parts?: unknown; text?: unknown; message?: unknown };
    if (record.parts !== undefined) return textOf(record.parts);
    if (typeof record.text === "string") return record.text;
    if (record.message !== undefined) return textOf(record.message);
  }
  return "";
}

function timestampOf(entry: Record<string, unknown>): number | null {
  for (const key of ["timestamp", "time", "createdAt", "date"]) {
    const value = entry[key];
    if (typeof value === "number") return value > 1e12 ? value : value * 1000;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

async function sessionFiles(root: string): Promise<SessionFile[]> {
  const tmp = basename(root) === "tmp" ? root : resolve(root, "tmp");
  if (!existsSync(tmp)) return [];

  const out: SessionFile[] = [];
  for (const entry of await readdir(tmp, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(tmp, entry.name);
    for (const file of await readdir(dir).catch(() => [])) {
      if (file === "logs.json") {
        out.push({ path: resolve(dir, file), tag: null });
        continue;
      }
      const checkpoint = /^checkpoint-(.+)\.json$/i.exec(file);
      if (checkpoint) out.push({ path: resolve(dir, file), tag: checkpoint[1] });
    }
  }
  return out;
}

/** Every entry shape seen so far reduces to a role and some text. */
function toMessages(parsed: unknown): NormalizedMessage[] {
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as { history?: unknown[]; messages?: unknown[] }).history ??
        (parsed as { messages?: unknown[] }).messages ??
        [])
      : [];

  const messages: NormalizedMessage[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) break;

    const record = entry as Record<string, unknown>;
    // Gemini writes the speaker as `role` ("user"/"model") or as `type`.
    const rawRole =
      typeof record.role === "string"
        ? record.role
        : typeof record.type === "string"
          ? record.type
          : undefined;
    const role = normalizeRole(rawRole === "model" ? "assistant" : rawRole);
    if (role === "other") continue;

    const text = cap(textOf(record.parts ?? record.content ?? record.message ?? record.text));
    if (!text) continue;
    messages.push({ role, text });
  }
  return messages;
}

export const geminiAdapter: ImportAdapter = {
  id: "gemini",
  label: "Gemini CLI local sessions",

  defaultPaths() {
    return [resolve(homedir(), ".gemini")];
  },

  async inspect(path) {
    const files = await sessionFiles(path);
    if (files.length === 0) return null;
    const named = files.filter((file) => file.tag).length;
    return {
      source: "gemini",
      path,
      detail: named
        ? `${files.length} session files, ${named} saved under a name`
        : `${files.length} session files`,
    };
  },

  async *load(path) {
    for (const file of await sessionFiles(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(file.path, "utf8"));
      } catch {
        continue; // A half-written session should not abort the import.
      }

      const messages = toMessages(parsed);
      if (messages.length === 0) continue;

      const stamps = (Array.isArray(parsed) ? parsed : [])
        .filter(
          (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
        )
        .map(timestampOf)
        .filter((value): value is number => value !== null);

      yield {
        id: `gemini:${file.path}`,
        title:
          file.tag ??
          messages.find((message) => message.role === "user")?.text.slice(0, 90) ??
          "(untitled session)",
        // A `/chat save` tag is a name the operator chose; a log file is not.
        syntheticTitle: file.tag === null,
        createdAt: stamps.length ? Math.min(...stamps) : null,
        updatedAt: stamps.length ? Math.max(...stamps) : null,
        source: "gemini",
        messages,
      } satisfies NormalizedConversation;
    }
  },
};
