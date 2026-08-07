import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { prettifyDirName } from "./dirname.js";
import {
  cap,
  MAX_MESSAGE_CHARS,
  type ImportAdapter,
  type NormalizedConversation,
} from "./types.js";

/**
 * A plain folder of Markdown notes — the state most people are in before they
 * have a vault at all. Each file is treated as one "conversation": its title is
 * the H1 or the filename, its containing directory is the grouping signal, and
 * its text feeds the same candidate analysis as a chat export.
 *
 * This is the one source with no AI history in it, and it is deliberately not
 * probed automatically: pointing it at the wrong directory would mine a whole
 * disk. It is only used when the operator names a path.
 */

const MAX_FILES = 5000;
const SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  ".trash",
  "_archive",
  ".vault-state",
]);

interface FoundNote {
  path: string;
  /** Directory name relative to the scanned root, or null at the top level. */
  group: string | null;
}

async function markdownFiles(
  root: string,
  depth = 0,
  group: string | null = null,
): Promise<FoundNote[]> {
  if (depth > 4) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: FoundNote[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.isDirectory() && !SKIP_DIRS.has(entry.name)) continue;
    const full = resolve(root, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // The first directory level is the grouping: deeper nesting keeps the
      // name of the folder the operator would call the project.
      const nextGroup = group ?? prettifyDirName(entry.name);
      out.push(...(await markdownFiles(full, depth + 1, nextGroup)));
      continue;
    }

    if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) {
      out.push({ path: full, group });
    }
    if (out.length >= MAX_FILES) break;
  }

  return out;
}

/** The first heading, falling back to the filename. */
function titleOf(content: string, path: string): { title: string; synthetic: boolean } {
  const heading = /^#\s+(.+)$/m.exec(content);
  if (heading) return { title: heading[1].trim(), synthetic: false };
  const name = basename(path).replace(/\.(md|markdown|txt)$/i, "");
  // A filename is a name someone chose, so it counts as a real title.
  return { title: prettifyDirName(name.replace(/[-_]+/g, " ")), synthetic: false };
}

export const markdownAdapter: ImportAdapter = {
  id: "markdown",
  label: "Folder of Markdown notes",

  defaultPaths() {
    // Never probed automatically: the operator must name the directory.
    return [];
  },

  async inspect(path) {
    if (!existsSync(path)) return null;
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) return null;

    const files = await markdownFiles(path);
    if (files.length === 0) return null;
    const groups = new Set(files.map((file) => file.group).filter(Boolean)).size;
    return {
      source: "markdown",
      path,
      detail: groups ? `${files.length} notes across ${groups} folders` : `${files.length} notes`,
    };
  },

  async *load(path) {
    for (const file of await markdownFiles(path)) {
      const content = await readFile(file.path, "utf8").catch(() => "");
      if (!content.trim()) continue;

      const { title, synthetic } = titleOf(content, file.path);
      const info = await stat(file.path).catch(() => null);

      yield {
        id: `markdown:${file.path}`,
        title,
        syntheticTitle: synthetic,
        createdAt: info ? Math.round(info.birthtimeMs) || null : null,
        updatedAt: info ? Math.round(info.mtimeMs) : null,
        source: "markdown",
        group: file.group ?? undefined,
        // The analyzer only mines user messages for supporting mentions, so the
        // note body is presented as one.
        messages: [{ role: "user", text: cap(content.slice(0, MAX_MESSAGE_CHARS * 2)) }],
      } satisfies NormalizedConversation;
    }
  },
};
