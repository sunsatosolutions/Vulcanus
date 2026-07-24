import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptDriver } from "../src/prompts.js";
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

export interface AskedQuestion {
  kind: "text" | "select" | "multiselect" | "confirm";
  message: string;
  /** Selectable values, so a test can assert what was actually on offer. */
  choices?: string[];
}

/**
 * A prompt driver that answers from a fixed script and records what it was
 * asked, in order. The recording is the point: it pins down which questions a
 * wizard asks in which mode, which is otherwise only observable through a TTY.
 */
export function scriptedPrompts(answers: unknown[]): {
  driver: PromptDriver;
  asked: AskedQuestion[];
} {
  const asked: AskedQuestion[] = [];
  let cursor = 0;

  function next<T>(kind: AskedQuestion["kind"], message: string, choices?: string[]): T {
    asked.push({ kind, message, ...(choices ? { choices } : {}) });
    if (cursor >= answers.length) {
      throw new Error(`Unscripted ${kind} prompt: ${message}`);
    }
    return answers[cursor++] as T;
  }

  return {
    asked,
    driver: {
      async text(request) {
        return next<string>("text", request.message);
      },
      async select(request) {
        return next<string>(
          "select",
          request.message,
          request.options.map((option) => option.value),
        );
      },
      async multiselect(request) {
        return next<string[]>(
          "multiselect",
          request.message,
          request.options.map((option) => option.value),
        );
      },
      async confirm(request) {
        return next<boolean>("confirm", request.message);
      },
    },
  };
}
