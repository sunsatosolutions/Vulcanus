import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_STRUCTURE,
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  type VaultManifest,
} from "./schema.js";

export class ManifestError extends Error {}

/** Walk upward from `startDir` looking for the vault manifest. */
export function findVaultRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(current, MANIFEST_FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function manifestPath(vaultRoot: string): string {
  return resolve(vaultRoot, MANIFEST_FILENAME);
}

export async function readManifest(vaultRoot: string): Promise<VaultManifest> {
  const file = manifestPath(vaultRoot);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new ManifestError(`No ${MANIFEST_FILENAME} found at ${vaultRoot}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestError(`${MANIFEST_FILENAME} is not valid JSON: ${(error as Error).message}`);
  }

  return normalizeManifest(parsed as Partial<VaultManifest>);
}

export async function writeManifest(vaultRoot: string, manifest: VaultManifest): Promise<void> {
  await writeFile(manifestPath(vaultRoot), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Fill in defaults so older or hand-edited manifests still load.
 *
 * Every level spreads what it was given before applying defaults, so a field
 * this CLI has never heard of survives the read/write round trip. The manifest
 * is the operator's file as much as the generator's: an unrecognized key is
 * something someone wrote on purpose, not debris to tidy away. Rebuilding the
 * object field by field is what silently erased hand-added `kind` and
 * `visibility` markers from a real vault during an update — including the
 * `visibility: private` flags that were the only thing telling an agent not to
 * treat a project as public.
 */
export function normalizeManifest(input: Partial<VaultManifest>): VaultManifest {
  if (!input || typeof input !== "object") {
    throw new ManifestError("manifest must be a JSON object");
  }
  if (!input.vault?.name) throw new ManifestError("manifest is missing vault.name");
  if (!input.admin?.name) throw new ManifestError("manifest is missing admin.name");

  return {
    ...input,
    manifestVersion: input.manifestVersion ?? MANIFEST_VERSION,
    generator: input.generator ?? { name: "vulcanus", version: "0.0.0" },
    vault: {
      ...input.vault,
      name: input.vault.name,
      language: input.vault.language ?? "en",
      naming: input.vault.naming ?? "branded",
      profile: input.vault.profile ?? "core",
    },
    admin: {
      ...input.admin,
      name: input.admin.name,
      aliases: input.admin.aliases ?? [],
      language: input.admin.language ?? input.vault.language ?? "en",
      workingStyle: input.admin.workingStyle ?? [],
      technical: input.admin.technical ?? [],
      boundaries: input.admin.boundaries ?? [],
    },
    structure: { ...DEFAULT_STRUCTURE, ...(input.structure ?? {}) },
    systemNotes: input.systemNotes ?? [],
    groups: (input.groups ?? []).map((group) => ({
      ...group,
      navigationOnly: group.navigationOnly ?? true,
    })),
    projects: (input.projects ?? []).map((project) => ({
      ...project,
      parent: project.parent ?? null,
      group: project.group ?? null,
      status: project.status ?? "active",
      summary: project.summary ?? "",
      triggers: project.triggers ?? [],
      specialized: project.specialized ?? [],
    })),
    imports: input.imports ?? [],
  };
}
