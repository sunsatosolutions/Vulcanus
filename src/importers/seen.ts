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

export interface SeenLedger {
  version: 1;
  /** Conversation ids per source, in the order they were first seen. */
  sources: Partial<Record<ImportSourceId, { ids: string[]; updatedAt: string }>>;
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

export function seenIds(ledger: SeenLedger, source: ImportSourceId): Set<string> {
  return new Set(ledger.sources[source]?.ids ?? []);
}

export function rememberIds(
  ledger: SeenLedger,
  source: ImportSourceId,
  ids: Iterable<string>,
): SeenLedger {
  const merged = new Set(ledger.sources[source]?.ids ?? []);
  for (const id of ids) merged.add(id);
  return {
    version: 1,
    sources: {
      ...ledger.sources,
      [source]: { ids: [...merged], updatedAt: new Date().toISOString() },
    },
  };
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
