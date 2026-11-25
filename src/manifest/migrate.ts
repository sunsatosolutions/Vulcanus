import { MANIFEST_VERSION, type VaultManifest } from "./schema.js";

export interface Migration {
  /** The manifest version this migration produces. */
  to: number;
  description: string;
  apply(manifest: VaultManifest): VaultManifest;
}

/**
 * Ordered manifest migrations. Each one takes a manifest at `to - 1` and returns
 * it at `to`, so a schema change can never silently corrupt an existing vault.
 */
export const MIGRATIONS: Migration[] = [
  {
    to: 2,
    description: "optional note freshness settings (absent: freshness stays off)",
    // The new field is optional, so a version 1 manifest is already valid; the
    // step only records the schema it was written against.
    apply: (manifest) => manifest,
  },
];

export interface MigrationResult {
  manifest: VaultManifest;
  applied: string[];
  /** The vault was written by a newer CLI than the one running. */
  fromFuture: boolean;
}

export function migrateManifest(input: VaultManifest): MigrationResult {
  const fromFuture = input.manifestVersion > MANIFEST_VERSION;
  if (fromFuture) {
    return { manifest: input, applied: [], fromFuture: true };
  }

  let manifest = input;
  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (manifest.manifestVersion >= migration.to) continue;
    manifest = migration.apply(manifest);
    manifest = { ...manifest, manifestVersion: migration.to };
    applied.push(`v${migration.to}: ${migration.description}`);
  }

  if (manifest.manifestVersion < MANIFEST_VERSION) {
    manifest = { ...manifest, manifestVersion: MANIFEST_VERSION };
  }

  return { manifest, applied, fromFuture: false };
}
