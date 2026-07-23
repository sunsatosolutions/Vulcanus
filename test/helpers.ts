import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectNode, VaultManifest } from "../src/manifest/schema.js";

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vulcanus-test-"));
}

export async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function project(id: string, name: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    name,
    parent: null,
    group: null,
    status: "active",
    summary: `${name} summary.`,
    triggers: [name.toLowerCase()],
    specialized: [],
    ...extra,
  };
}

export function manifest(overrides: Partial<VaultManifest> = {}): VaultManifest {
  return {
    manifestVersion: 1,
    generator: { name: "vulcanus", version: "test" },
    vault: {
      name: "ATLAS",
      fullName: "Archive of Thought and Systems",
      language: "en",
      naming: "branded",
      profile: "core",
    },
    admin: {
      name: "Ada",
      role: "Builder",
      aliases: ["me"],
      language: "en",
      workingStyle: [],
      technical: [],
      boundaries: [],
    },
    structure: {
      systemDir: "00_System",
      projectsDir: "02_Projects",
      importsDir: "_imports",
      stateDir: ".atlas",
    },
    groups: [],
    projects: [],
    imports: [],
    ...overrides,
  };
}
