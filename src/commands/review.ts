import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadVaultNotes, vaultFreshness } from "../doctor/index.js";
import { EXIT, noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { oldestFirst, stampReviewed, type NoteFreshness } from "../memory/freshness.js";
import { today } from "../memory/lifecycle.js";
import * as p from "../ui.js";

export interface ReviewOptions {
  cwd?: string;
  /** Mark this note as reviewed today instead of listing. */
  ok?: string;
  json?: boolean;
  /** ISO date treated as today; injectable for tests. */
  today?: string;
}

const stem = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
const key = (value: string) => value.normalize("NFC").toLowerCase();

export async function reviewCommand(options: ReviewOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus review"));

  const manifest = await readManifest(vaultRoot);
  const on = options.today ?? today();
  const notes = await loadVaultNotes(vaultRoot, manifest);

  if (options.ok !== undefined) {
    const query = key(options.ok.replace(/\.md$/i, ""));
    const matches = notes.files.filter(
      (file) => key(stem(file)) === query || key(file.replace(/\.md$/i, "")) === query,
    );
    if (matches.length !== 1) {
      return reportProblem({
        what:
          matches.length === 0
            ? `No note named "${options.ok}".`
            : `"${options.ok}" matches ${matches.length} notes.`,
        why:
          matches.length === 0
            ? "Names are matched against the managed notes."
            : matches.join(", "),
        fix: matches.length === 0 ? "vulcanus review" : "use the vault-relative path",
      });
    }

    const file = matches[0];
    const next = stampReviewed(notes.contents.get(file)!, on);
    if (next === null) {
      return reportProblem({
        what: `${file} has no frontmatter to hold a reviewed: date.`,
        fix: "add a --- frontmatter block to the note first",
      });
    }
    const changed = next !== notes.contents.get(file);
    if (changed) await writeFile(resolve(vaultRoot, file), next, "utf8");

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ note: file, reviewed: on, changed }, null, 2)}\n`);
    } else {
      p.log.success(`${file}: reviewed ${on}${changed ? "" : " (already)"}`);
    }
    return EXIT.ok;
  }

  const enabled = manifest.freshness !== undefined;
  const stale: NoteFreshness[] = oldestFirst(vaultFreshness(vaultRoot, manifest, notes, on));

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ enabled, today: on, stale }, null, 2)}\n`);
    return EXIT.ok;
  }

  p.intro(`review — ${manifest.vault.name}`);
  if (!enabled) {
    p.outro("Freshness is off: add `freshness.staleAfterDays` to vulcanus.json to turn it on.");
  } else if (stale.length === 0) {
    p.outro("No stale notes.");
  } else {
    p.log.message(
      stale.map((note) => `${note.ageDays}d (limit ${note.staleAfter}d)  ${note.path}`).join("\n"),
    );
    p.outro(`${stale.length} stale — check one, then: vulcanus review --ok <note>`);
  }
  return EXIT.ok;
}
