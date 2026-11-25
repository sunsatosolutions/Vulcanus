import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateFiles } from "../generate/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { SOURCE_FILE, TARGETS, readMarker, renderTarget } from "./targets.js";

export type BridgeAction =
  | "create"
  | "update"
  | "unchanged"
  /** A file with no Vulcanus marker: the operator's, left alone. */
  | "hand-written"
  /** The vault already generates a file for this tool. */
  | "vault-managed";

export interface BridgeEntry {
  path: string;
  action: BridgeAction;
  before: string | null;
  after: string | null;
}

/**
 * The repository the bridge runs in: the vault when there is a `vulcanus.json`,
 * otherwise the current folder. A repo without a manifest still has an
 * `AGENTS.md`, and that is all the bridge needs.
 */
export function bridgeRoot(start: string): string {
  return findVaultRoot(start) ?? resolve(start);
}

export async function planBridge(root: string): Promise<BridgeEntry[]> {
  const source = await readFile(resolve(root, SOURCE_FILE), "utf8");

  const vaultPaths = new Set<string>();
  if (findVaultRoot(root) === root) {
    for (const file of generateFiles(await readManifest(root)).files) vaultPaths.add(file.path);
  }

  const entries: BridgeEntry[] = [];
  for (const target of TARGETS) {
    if (target.vaultTwin && vaultPaths.has(target.vaultTwin)) {
      entries.push({ path: target.path, action: "vault-managed", before: null, after: null });
      continue;
    }
    const file = resolve(root, target.path);
    const before = existsSync(file) ? await readFile(file, "utf8") : null;
    const after = renderTarget(target, source);
    let action: BridgeAction;
    if (before === null) action = "create";
    else if (!readMarker(before)) action = "hand-written";
    else action = before === after ? "unchanged" : "update";
    entries.push({ path: target.path, action, before, after });
  }
  return entries;
}

/** Writes only what the plan marked create or update; a hand-written file is never in that set. */
export async function applyBridge(root: string, entries: BridgeEntry[]): Promise<string[]> {
  const written: string[] = [];
  for (const entry of entries) {
    if ((entry.action !== "create" && entry.action !== "update") || entry.after === null) continue;
    const file = resolve(root, entry.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, entry.after, "utf8");
    written.push(entry.path);
  }
  return written;
}
