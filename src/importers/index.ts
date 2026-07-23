import { chatgptAdapter } from "./chatgpt.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { claudeExportAdapter } from "./claude-export.js";
import { codexAdapter } from "./codex.js";
import type { DetectedSource, ImportAdapter, ImportSourceId } from "./types.js";

export const ADAPTERS: ImportAdapter[] = [
  chatgptAdapter,
  claudeExportAdapter,
  claudeCodeAdapter,
  codexAdapter,
];

export function adapterFor(id: ImportSourceId): ImportAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

/**
 * Probe each adapter's default locations. A ChatGPT or Claude export usually
 * lands in ~/Downloads as a dated folder, so those are scanned one level deep.
 */
export async function detectSources(extraPaths: string[] = []): Promise<DetectedSource[]> {
  const { readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  const found: DetectedSource[] = [];
  const seen = new Set<string>();

  const consider = async (adapter: ImportAdapter, path: string): Promise<boolean> => {
    const marker = `${adapter.id}:${path}`;
    if (seen.has(marker)) return false;
    seen.add(marker);
    const detected = await adapter.inspect(path).catch(() => null);
    if (detected) found.push(detected);
    return detected !== null;
  };

  for (const adapter of ADAPTERS) {
    for (const base of [...adapter.defaultPaths(), ...extraPaths]) {
      if (!existsSync(base)) continue;

      // A directory that already matches covers its children (Codex would
      // otherwise report ~/.codex, ~/.codex/sessions, and archived_sessions).
      if (await consider(adapter, base)) continue;

      // Exports arrive as a dated subdirectory; look one level in.
      const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        await consider(adapter, resolve(base, entry.name));
      }
    }
  }

  return found;
}

export type { DetectedSource, ImportAdapter, ImportSourceId } from "./types.js";
export type { NormalizedConversation } from "./types.js";
export { analyzeConversations } from "./analyze.js";
export type { AnalysisResult, ProjectCandidate, Confidence } from "./analyze.js";
