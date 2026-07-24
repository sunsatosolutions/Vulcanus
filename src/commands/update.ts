import * as p from "@clack/prompts";
import { runDoctor } from "../doctor/index.js";
import { generateFiles, writeFiles, type WriteResult } from "../generate/index.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest, writeManifest } from "../manifest/io.js";
import { migrateManifest } from "../manifest/migrate.js";
import { MANIFEST_VERSION, type VaultManifest, type VaultProfile } from "../manifest/schema.js";
import { compareVersions } from "../util/semver.js";
import { CLI_VERSION } from "../version.js";
import { reportDoctor } from "./doctor.js";

export interface UpdateOptions {
  cwd?: string;
  /** Show what would change without writing anything. */
  dryRun?: boolean;
  /** Also rewrite operator-owned notes. Destructive; never the default. */
  force?: boolean;
  /** Switch the system layer depth while updating. */
  profile?: VaultProfile;
  json?: boolean;
}

export interface UpdateSummary {
  vault: string;
  fromVersion: string;
  toVersion: string;
  migrations: string[];
  created: string[];
  updated: string[];
  unchanged: number;
  preserved: number;
  /** Notes on disk that the manifest no longer describes. */
  orphans: string[];
  ok: boolean;
  dryRun: boolean;
}

function partition(results: WriteResult[]) {
  return {
    created: results.filter((entry) => entry.action === "created").map((entry) => entry.path),
    updated: results.filter((entry) => entry.action === "updated").map((entry) => entry.path),
    unchanged: results.filter((entry) => entry.action === "unchanged").length,
    preserved: results.filter((entry) => entry.action === "skipped").length,
  };
}

export async function updateCommand(options: UpdateOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    process.stderr.write("No vulcanus.json found. Run `vulcanus init` first.\n");
    return 2;
  }

  const existing = await readManifest(vaultRoot);
  const fromVersion = existing.generator.version;

  const migration = migrateManifest(existing);
  if (migration.fromFuture) {
    process.stderr.write(
      [
        `This vault uses manifest version ${existing.manifestVersion}, but this CLI understands ${MANIFEST_VERSION}.`,
        `It was written by Vulcanus ${fromVersion}; you are running ${CLI_VERSION}.`,
        "Upgrade the CLI first: npm i -g vulcanus@latest",
        "",
      ].join("\n"),
    );
    return 2;
  }

  const manifest: VaultManifest = {
    ...migration.manifest,
    ...(options.profile
      ? { vault: { ...migration.manifest.vault, profile: options.profile } }
      : {}),
    generator: { name: "vulcanus", version: CLI_VERSION },
  };

  const { files } = generateFiles(manifest);

  // Regenerate files the CLI owns; hand-written memory is preserved unless the
  // operator explicitly asks for --force.
  const results = await writeFiles(vaultRoot, files, {
    repair: true,
    force: options.force,
    dryRun: options.dryRun,
  });
  const { created, updated, unchanged, preserved } = partition(results);

  if (!options.dryRun) await writeManifest(vaultRoot, manifest);

  // Anything still on disk but no longer planned is reported, never deleted.
  const report = await runDoctor(vaultRoot, manifest);
  const orphans = report.findings
    .filter((finding) => finding.code === "UNMANAGED" && finding.file)
    .map((finding) => finding.file as string);

  const summary: UpdateSummary = {
    vault: manifest.vault.name,
    fromVersion,
    toVersion: CLI_VERSION,
    migrations: migration.applied,
    created,
    updated,
    unchanged,
    preserved,
    orphans,
    ok: report.ok,
    dryRun: Boolean(options.dryRun),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  p.intro(`update — ${manifest.vault.name}`);

  if (
    compareVersions(fromVersion, CLI_VERSION) === 0 &&
    created.length === 0 &&
    updated.length === 0
  ) {
    p.log.success(`Already current (Vulcanus ${CLI_VERSION}).`);
  } else {
    p.log.info(`Vulcanus ${fromVersion} → ${CLI_VERSION}`);
  }

  for (const applied of migration.applied) {
    p.log.step(`migrated ${applied}`);
  }

  const lines: string[] = [];
  if (created.length) lines.push(`created (${created.length}):\n  ${created.join("\n  ")}`);
  if (updated.length) lines.push(`refreshed (${updated.length}):\n  ${updated.join("\n  ")}`);
  if (unchanged) lines.push(`already current: ${unchanged}`);
  if (preserved) lines.push(`your notes, left untouched: ${preserved}`);
  if (lines.length) p.note(lines.join("\n\n"), options.dryRun ? "Would change" : "Changed");

  if (orphans.length) {
    p.log.warn(
      [
        "These notes are no longer described by the manifest and were left in place:",
        ...orphans.map((path) => `  ${path}`),
        "Delete them yourself if they are obsolete.",
      ].join("\n"),
    );
  }

  if (!report.ok) reportDoctor(report);

  const plan = buildPlan(manifest);
  const outro = options.dryRun
    ? "Dry run — nothing was written."
    : `${report.ok ? "PASS" : "FAIL"} — ${plan.allNotes.length} planned notes, ${report.counts.error} errors`;
  p.outro(outro);

  return report.ok ? 0 : 1;
}
