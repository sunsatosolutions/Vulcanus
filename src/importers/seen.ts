import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { VaultManifest } from "../manifest/schema.js";
import type { ImportSourceId, NormalizedConversation } from "./types.js";

/**
 * Which conversations an import has already looked at, so pointing the CLI at
 * the same export a second time proposes only what is new.
 *
 * The ledger lives in the vault's state directory rather than in
 * `vulcanus.json`: it grows with every conversation ever scanned, it is pure
 * cache, and it is already git-ignored — a manifest that carried thousands of
 * conversation ids would turn every import into an unreadable diff.
 */

const FILE = "imports.json";

type SeenBySource = Partial<Record<ImportSourceId, { ids: string[]; updatedAt: string }>>;

/**
 * Project discovery and the memory review keep separate lists: a conversation
 * scanned for project names has not been reviewed for decisions, and a
 * memory-only run must not hide conversations from the next project import.
 */
export type SeenScope = "projects" | "memory";

export interface SeenLedger {
  version: 1;
  /** Conversation ids per source scanned for projects, in the order first seen. */
  sources: SeenBySource;
  /** Conversation ids per source whose memory candidates were reviewed. */
  memory?: SeenBySource;
}

function bucket(ledger: SeenLedger, scope: SeenScope): SeenBySource {
  return (scope === "memory" ? ledger.memory : ledger.sources) ?? {};
}

function ledgerPath(vaultRoot: string, manifest: VaultManifest): string {
  return resolve(vaultRoot, manifest.structure.stateDir, FILE);
}

export async function readSeen(vaultRoot: string, manifest: VaultManifest): Promise<SeenLedger> {
  const path = ledgerPath(vaultRoot, manifest);
  if (!existsSync(path)) return { version: 1, sources: {} };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as SeenLedger;
    if (parsed.version !== 1 || typeof parsed.sources !== "object")
      return { version: 1, sources: {} };
    return parsed;
  } catch {
    // A corrupt cache must never block an import; it just means a full rescan.
    return { version: 1, sources: {} };
  }
}

export async function writeSeen(
  vaultRoot: string,
  manifest: VaultManifest,
  ledger: SeenLedger,
): Promise<void> {
  const path = ledgerPath(vaultRoot, manifest);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export function seenIds(
  ledger: SeenLedger,
  source: ImportSourceId,
  scope: SeenScope = "projects",
): Set<string> {
  return new Set(bucket(ledger, scope)[source]?.ids ?? []);
}

export function rememberIds(
  ledger: SeenLedger,
  source: ImportSourceId,
  ids: Iterable<string>,
  scope: SeenScope = "projects",
): SeenLedger {
  const current = bucket(ledger, scope);
  const merged = new Set(current[source]?.ids ?? []);
  for (const id of ids) merged.add(id);
  const updated = {
    ...current,
    [source]: { ids: [...merged], updatedAt: new Date().toISOString() },
  };
  return scope === "memory" ? { ...ledger, memory: updated } : { ...ledger, sources: updated };
}

/**
 * Wrap a conversation stream so already-seen conversations are skipped, while
 * still recording every id the stream produced — including the skipped ones, so
 * a later run does not resurrect them.
 */
export function skipSeen(
  stream: () => AsyncIterable<NormalizedConversation>,
  seen: Set<string>,
  record: Set<string>,
): () => AsyncIterable<NormalizedConversation> {
  return () =>
    (async function* filtered() {
      for await (const conversation of stream()) {
        record.add(conversation.id);
        if (seen.has(conversation.id)) continue;
        yield conversation;
      }
    })();
}
