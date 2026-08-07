import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, resolve } from "node:path";
import { prettifyDirName } from "./dirname.js";
import {
  cap,
  normalizeRole,
  MAX_MESSAGES_PER_CONVERSATION,
  type ImportAdapter,
  type NormalizedConversation,
  type NormalizedMessage,
} from "./types.js";

/**
 * Cursor stores chat history in a SQLite database per workspace
 * (`workspaceStorage/<hash>/state.vscdb`), alongside a `workspace.json` that
 * records which folder the workspace was opened on — and that folder name is
 * the strongest project signal any importer gets.
 *
 * Reading it needs SQLite. Rather than pull in a native dependency for one
 * adapter, this uses the built-in `node:sqlite`. Every supported Node has it,
 * but it is still loaded defensively: the module is behind an experimental flag
 * on some builds, and an adapter that throws on import would take the whole
 * source list down with it. When it is missing, the adapter says so.
 */

interface SqliteRow {
  key?: unknown;
  value?: unknown;
}

interface SqliteStatement {
  all(...params: unknown[]): SqliteRow[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let sqliteCache: SqliteModule | null | undefined;

/** `null` when this Node build has no SQLite; the module otherwise. */
async function sqlite(): Promise<SqliteModule | null> {
  if (sqliteCache !== undefined) return sqliteCache;
  try {
    // Indirect specifier: a static import would make a runtime without SQLite
    // fail at module load rather than at the one call that needs it.
    const specifier = "node:sqlite";
    sqliteCache = (await import(/* @vite-ignore */ specifier)) as SqliteModule;
  } catch {
    sqliteCache = null;
  }
  return sqliteCache;
}

export function workspaceStorageDirs(): string[] {
  const home = homedir();
  const roots =
    platform() === "darwin"
      ? [resolve(home, "Library/Application Support/Cursor/User/workspaceStorage")]
      : platform() === "win32"
        ? [
            resolve(
              process.env.APPDATA ?? resolve(home, "AppData/Roaming"),
              "Cursor/User/workspaceStorage",
            ),
          ]
        : [
            resolve(home, ".config/Cursor/User/workspaceStorage"),
            resolve(home, ".cursor/User/workspaceStorage"),
          ];
  return roots;
}

async function workspaceDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name))
    .filter((dir) => existsSync(resolve(dir, "state.vscdb")));
}

/** The folder this workspace was opened on, as a project name. */
async function workspaceProject(dir: string): Promise<string | undefined> {
  const file = resolve(dir, "workspace.json");
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { folder?: unknown };
    if (typeof parsed.folder !== "string") return undefined;
    const path = decodeURIComponent(parsed.folder.replace(/^file:\/\//, ""));
    const name = basename(path);
    return name ? prettifyDirName(name) : undefined;
  } catch {
    return undefined;
  }
}

/** Cursor's chat blobs are JSON in the ItemTable key/value store. */
const CHAT_KEYS = [
  "workbench.panel.aichat.view.aichat.chatdata",
  "workbench.panel.composerChatViewPane.view.composerChat.chatdata",
  "aiService.prompts",
];

function messagesFrom(blob: unknown): NormalizedMessage[][] {
  const conversations: NormalizedMessage[][] = [];

  const tabs: unknown[] = Array.isArray(blob)
    ? blob
    : blob && typeof blob === "object"
      ? ((blob as { tabs?: unknown[] }).tabs ?? [blob])
      : [];

  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue;
    const bubbles = (tab as { bubbles?: unknown[]; messages?: unknown[] }).bubbles ??
      (tab as { messages?: unknown[] }).messages ?? [tab];

    const messages: NormalizedMessage[] = [];
    for (const bubble of bubbles) {
      if (!bubble || typeof bubble !== "object") continue;
      if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) break;
      const record = bubble as { type?: unknown; role?: unknown; text?: unknown };
      const rawRole =
        typeof record.role === "string"
          ? record.role
          : typeof record.type === "string"
            ? record.type
            : undefined;
      const role = normalizeRole(rawRole === "ai" ? "assistant" : rawRole);
      if (role === "other") continue;
      const text = cap(typeof record.text === "string" ? record.text : "");
      if (!text) continue;
      messages.push({ role, text });
    }
    if (messages.length) conversations.push(messages);
  }

  return conversations;
}

async function readChats(dbPath: string): Promise<unknown[]> {
  const module = await sqlite();
  if (!module) return [];

  let db: SqliteDatabase | null = null;
  try {
    db = new module.DatabaseSync(dbPath, { readOnly: true });
    const placeholders = CHAT_KEYS.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT key, value FROM ItemTable WHERE key IN (${placeholders})`)
      .all(...CHAT_KEYS);

    const blobs: unknown[] = [];
    for (const row of rows) {
      const value = typeof row.value === "string" ? row.value : null;
      if (!value) continue;
      try {
        blobs.push(JSON.parse(value));
      } catch {
        // A key we recognized holding something we do not: skip it.
      }
    }
    return blobs;
  } catch {
    // A database locked by a running Cursor, or a schema we do not know.
    return [];
  } finally {
    db?.close();
  }
}

export const cursorAdapter: ImportAdapter = {
  id: "cursor",
  label: "Cursor local chats",

  defaultPaths() {
    return workspaceStorageDirs();
  },

  async inspect(path) {
    const dirs = await workspaceDirs(path);
    if (dirs.length === 0) return null;
    if (!(await sqlite())) {
      return {
        source: "cursor",
        path,
        detail: `${dirs.length} workspaces — this Node build has no SQLite (${process.version})`,
      };
    }
    return { source: "cursor", path, detail: `${dirs.length} workspaces with chat history` };
  },

  async *load(path) {
    for (const dir of await workspaceDirs(path)) {
      const group = await workspaceProject(dir);
      const blobs = await readChats(resolve(dir, "state.vscdb"));

      let index = 0;
      for (const blob of blobs) {
        for (const messages of messagesFrom(blob)) {
          index += 1;
          yield {
            id: `cursor:${basename(dir)}:${index}`,
            title: messages[0]?.text.slice(0, 90) ?? "(untitled chat)",
            // Cursor chats have no operator-chosen title; the workspace folder
            // is the naming signal, and it arrives as `group`.
            syntheticTitle: true,
            createdAt: null,
            updatedAt: null,
            source: "cursor",
            group,
            messages,
          } satisfies NormalizedConversation;
        }
      }
    }
  },
};
