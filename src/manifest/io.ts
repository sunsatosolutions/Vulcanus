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

/** Fill in defaults so older or hand-edited manifests still load. */
export function normalizeManifest(input: Partial<VaultManifest>): VaultManifest {
  if (!input || typeof input !== "object") {
    throw new ManifestError("manifest must be a JSON object");
  }
  if (!input.vault?.name) throw new ManifestError("manifest is missing vault.name");
  if (!input.admin?.name) throw new ManifestError("manifest is missing admin.name");

  return {
    manifestVersion: input.manifestVersion ?? MANIFEST_VERSION,
    generator: input.generator ?? { name: "vulcanus", version: "0.0.0" },
    vault: {
      name: input.vault.name,
      fullName: input.vault.fullName,
      tagline: input.vault.tagline,
      language: input.vault.language ?? "en",
      naming: input.vault.naming ?? "branded",
      profile: input.vault.profile ?? "core",
    },
    admin: {
      name: input.admin.name,
      role: input.admin.role,
      aliases: input.admin.aliases ?? [],
      language: input.admin.language ?? input.vault.language ?? "en",
      workingStyle: input.admin.workingStyle ?? [],
      technical: input.admin.technical ?? [],
      boundaries: input.admin.boundaries ?? [],
    },
    structure: { ...DEFAULT_STRUCTURE, ...(input.structure ?? {}) },
    groups: (input.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      summary: group.summary,
      navigationOnly: group.navigationOnly ?? true,
    })),
    projects: (input.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      parent: project.parent ?? null,
      group: project.group ?? null,
      status: project.status ?? "active",
      summary: project.summary ?? "",
      triggers: project.triggers ?? [],
      specialized: project.specialized ?? [],
      dirName: project.dirName,
    })),
    imports: input.imports ?? [],
  };
}
