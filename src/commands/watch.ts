import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runDoctor } from "../doctor/index.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { readManifest } from "../manifest/io.js";
import * as p from "../ui.js";
import type { SyncOptions } from "./sync.js";

/** Edits arrive in bursts (an editor saving, a git checkout); coalesce them. */
const DEBOUNCE_MS = 400;

/**
 * Keep the CLI-owned files in step with the notes while the operator works:
 * every change re-runs the generator for `managed` files — the Index tree, the
 * hubs — and revalidates the graph.
 *
 * Watch mode deliberately never commits or pushes. A commit per keystroke would
 * bury the vault's history, and a push is an outward-facing action that stays
 * an explicit `vulcanus sync`.
 */
export async function watchVault(
  vaultRoot: string,
  options: SyncOptions & { signal?: AbortSignal } = {},
): Promise<number> {
  const manifest = await readManifest(vaultRoot);
  const watched = [manifest.structure.systemDir, manifest.structure.projectsDir]
    .map((dir) => resolve(vaultRoot, dir))
    .filter((dir) => existsSync(dir));

  if (watched.length === 0) {
    p.log.error(`Nothing to watch: ${vaultRoot} has no note directories yet.`);
    return 2;
  }

  p.intro(`sync --watch — ${manifest.vault.name}`);
  p.log.info(
    [
      `Watching ${watched.length} director${watched.length === 1 ? "y" : "ies"} for changes.`,
      "Managed files are regenerated and the graph revalidated on every edit.",
      "Nothing is committed or pushed — run `vulcanus sync` for that. Ctrl-C to stop.",
    ].join("\n"),
  );

  let running = false;
  let queued = false;
  let timer: NodeJS.Timeout | null = null;

  const pass = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      // Re-read the manifest each pass: a new project may be exactly what changed.
      const current = await readManifest(vaultRoot);
      const { files } = generateFiles(current);
      const results = await writeFiles(vaultRoot, files, { repair: true });
      const rewritten = results.filter((result) => result.action === "updated");
      for (const result of rewritten) p.log.debug(`regenerated ${result.path}`);

      const report = await runDoctor(vaultRoot, current);
      const stamp = new Date().toTimeString().slice(0, 8);
      if (report.ok) {
        p.log.success(
          `${stamp} PASS — ${report.filesChecked} notes, ${report.linksChecked} links${
            rewritten.length ? `, ${rewritten.length} regenerated` : ""
          }`,
        );
      } else {
        p.log.warn(`${stamp} FAIL — ${report.counts.error} error(s)`);
        for (const finding of report.findings.filter((entry) => entry.level === "error")) {
          p.log.message(`  ${finding.file ? `${finding.file}: ` : ""}${finding.message}`);
        }
      }
    } catch (error) {
      p.log.error(`watch pass failed: ${(error as Error).message}`);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void pass();
      }
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pass(), DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];
  for (const dir of watched) {
    try {
      watchers.push(watch(dir, { recursive: true }, schedule));
    } catch {
      // Recursive watching is unavailable on some platforms and filesystems;
      // the top level still catches note additions and removals.
      watchers.push(watch(dir, schedule));
    }
  }

  await pass();

  await new Promise<void>((resolvePromise) => {
    const stop = (): void => {
      for (const watcher of watchers) watcher.close();
      if (timer) clearTimeout(timer);
      resolvePromise();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    // Callers that are not a terminal — a test, a supervisor — stop it by abort.
    options.signal?.addEventListener("abort", stop, { once: true });
  });

  p.outro("watch stopped.");
  return 0;
}
