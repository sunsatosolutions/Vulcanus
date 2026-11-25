import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { bridgeCommand } from "../src/commands/bridge.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { collectStatus } from "../src/commands/status.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { checkInstructions } from "../src/instructions/check.js";
import { writeManifest } from "../src/manifest/io.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, tempDir } from "./helpers.js";

const dirs: string[] = [];
const COPIES = [".github/copilot-instructions.md", ".cursor/rules/agents.mdc"];

async function repo(agents = "# Rules\n\nBe kind.\n"): Promise<string> {
  const root = await tempDir();
  dirs.push(root);
  await writeFile(resolve(root, "AGENTS.md"), agents, "utf8");
  return root;
}

async function quietly<T>(action: () => Promise<T>): Promise<T> {
  setLogLevel("quiet");
  try {
    return await action();
  } finally {
    setLogLevel("normal");
  }
}

const read = (root: string, path: string) => readFile(resolve(root, path), "utf8");

after(async () => {
  for (const dir of dirs) await cleanup(dir);
});

describe("bridge", () => {
  it("shows a diff by default and writes nothing", async () => {
    const root = await repo();
    assert.equal(await quietly(() => bridgeCommand({ cwd: root })), 1);
    assert.equal(existsSync(resolve(root, "GEMINI.md")), false);
  });

  it("writes imports and marked copies, then a clean repo needs nothing", async () => {
    const root = await repo();
    assert.equal(await quietly(() => bridgeCommand({ cwd: root, write: true })), 0);

    assert.match(
      await read(root, "CLAUDE.md"),
      /^<!-- vulcanus:bridge source=AGENTS.md -->\n@AGENTS.md\n$/,
    );
    assert.match(await read(root, "GEMINI.md"), /\n@AGENTS.md\n$/);
    for (const path of COPIES) {
      assert.match(await read(root, path), /vulcanus:bridge source=AGENTS.md sha256=[0-9a-f]{64}/);
      assert.match(await read(root, path), /Be kind\./);
    }
    // The Cursor frontmatter must stay the first thing in the file.
    assert.ok((await read(root, ".cursor/rules/agents.mdc")).startsWith("---\n"));

    assert.equal(await quietly(() => bridgeCommand({ cwd: root })), 0);
    assert.equal(await quietly(() => doctorCommand({ cwd: root })), 0);
  });

  it("changes nothing on a second --write", async () => {
    const root = await repo();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    const before = await Promise.all(
      ["CLAUDE.md", "GEMINI.md", ...COPIES].map((path) => read(root, path)),
    );
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    const after = await Promise.all(
      ["CLAUDE.md", "GEMINI.md", ...COPIES].map((path) => read(root, path)),
    );
    assert.deepEqual(after, before);
  });

  it("flags stale copies in doctor and bridge --write fixes them", async () => {
    const root = await repo();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    await writeFile(resolve(root, "AGENTS.md"), "# Rules\n\nBe kind.\nAlways test.\n", "utf8");

    const findings = await checkInstructions(root);
    assert.deepEqual(findings.map((finding) => [finding.code, finding.file]).sort(), [
      ["INSTRUCTION-STALE", ".cursor/rules/agents.mdc"],
      ["INSTRUCTION-STALE", ".github/copilot-instructions.md"],
    ]);
    assert.equal(await quietly(() => doctorCommand({ cwd: root })), 1);

    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    assert.match(await read(root, ".github/copilot-instructions.md"), /Always test\./);
    assert.deepEqual(await checkInstructions(root), []);
  });

  it("never overwrites a hand-written file and reports it", async () => {
    const root = await repo();
    await writeFile(resolve(root, "CLAUDE.md"), "my own notes\n", "utf8");
    await mkdir(resolve(root, ".github"), { recursive: true });
    await writeFile(resolve(root, ".github/copilot-instructions.md"), "mine too\n", "utf8");

    assert.equal(await quietly(() => bridgeCommand({ cwd: root, write: true })), 0);
    assert.equal(await read(root, "CLAUDE.md"), "my own notes\n");
    assert.equal(await read(root, ".github/copilot-instructions.md"), "mine too\n");
    assert.equal(existsSync(resolve(root, "GEMINI.md")), true);
    // Not marked, so not the bridge's to judge either.
    assert.deepEqual(await checkInstructions(root), []);
  });

  it("is not fooled by a marker quoted deep in a hand-written file", async () => {
    const root = await repo();
    const text = `${"line\n".repeat(20)}<!-- vulcanus:bridge source=AGENTS.md -->\n`;
    await writeFile(resolve(root, "GEMINI.md"), text, "utf8");
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    assert.equal(await read(root, "GEMINI.md"), text);
  });

  it("is not fooled by a marker inside a fenced example in the first lines", async () => {
    const root = await repo();
    const text = "# Notes\n```md\n<!-- vulcanus:bridge source=AGENTS.md -->\n```\n";
    await writeFile(resolve(root, "GEMINI.md"), text, "utf8");
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    assert.equal(await read(root, "GEMINI.md"), text);
  });

  it("fails with a usage error when there is no AGENTS.md", async () => {
    const root = await tempDir();
    dirs.push(root);
    assert.equal(await quietly(() => bridgeCommand({ cwd: root, write: true })), 2);
  });

  it("treats CRLF and LF sources as the same text", async () => {
    const root = await repo("# Rules\r\n\r\nBe kind.\r\n");
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    await writeFile(resolve(root, "AGENTS.md"), "# Rules\n\nBe kind.\n", "utf8");
    assert.deepEqual(await checkInstructions(root), []);
  });

  it("accepts a CRLF checkout of the bridge files", async () => {
    const root = await repo();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    for (const path of ["CLAUDE.md", "GEMINI.md", ...COPIES]) {
      await writeFile(resolve(root, path), (await read(root, path)).replace(/\n/g, "\r\n"), "utf8");
    }
    assert.deepEqual(await checkInstructions(root), []);
    // bridge agrees with doctor: nothing to update.
    assert.equal(await quietly(() => bridgeCommand({ cwd: root })), 0);
  });

  it("flags a copy whose body was edited though its marker hash is intact", async () => {
    const root = await repo();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    const path = ".github/copilot-instructions.md";
    await writeFile(
      resolve(root, path),
      (await read(root, path)).replace("Be kind.", "Be rude."),
      "utf8",
    );
    assert.deepEqual(
      (await checkInstructions(root)).map((finding) => [finding.code, finding.file]),
      [["INSTRUCTION-STALE", path]],
    );
  });
});

describe("bridge inside a vault", () => {
  async function vault(): Promise<string> {
    const root = await tempDir();
    dirs.push(root);
    const input = manifest();
    await writeFiles(root, generateFiles(input).files);
    await writeManifest(root, input);
    return root;
  }

  it("does not add a second copy beside the files the vault generates", async () => {
    const root = await vault();
    const claude = await read(root, "CLAUDE.md");
    const cursor = await read(root, ".cursor/rules/vault.mdc");

    assert.equal(await quietly(() => bridgeCommand({ cwd: root, write: true })), 0);
    assert.equal(await read(root, "CLAUDE.md"), claude);
    assert.equal(await read(root, ".cursor/rules/vault.mdc"), cursor);
    assert.equal(existsSync(resolve(root, ".cursor/rules/agents.mdc")), false);
    assert.equal(existsSync(resolve(root, "GEMINI.md")), true);
  });

  it("counts drifted bridge files in doctor and status", async () => {
    const root = await vault();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    assert.equal((await collectStatus(root)).instructionDrift, 0);

    await writeFile(
      resolve(root, "AGENTS.md"),
      `${await read(root, "AGENTS.md")}\nMore.\n`,
      "utf8",
    );
    const status = await collectStatus(root);
    assert.equal(status.instructionDrift, 1);
    assert.equal(status.doctor.ok, false);
  });
});

describe("instruction budget and conflicts", () => {
  const codes = async (root: string) =>
    (await checkInstructions(root)).map((finding) => [finding.code, finding.file]);

  it("warns only above the 32 KiB budget, of the one file Codex reads", async () => {
    const under = await repo("x".repeat(32 * 1024));
    assert.deepEqual(await codes(under), []);

    const over = await repo("x".repeat(32 * 1024 + 1));
    assert.deepEqual(await codes(over), [["INSTRUCTION-BUDGET", "AGENTS.md"]]);
    assert.equal(await quietly(() => doctorCommand({ cwd: over })), 0);

    const split = await repo("x".repeat(20 * 1024));
    await writeFile(resolve(split, "AGENTS.override.md"), "y".repeat(13 * 1024), "utf8");
    assert.deepEqual(await codes(split), []);

    await writeFile(resolve(split, "AGENTS.override.md"), "y".repeat(32 * 1024 + 1), "utf8");
    assert.deepEqual(await codes(split), [["INSTRUCTION-BUDGET", "AGENTS.override.md"]]);

    await writeFile(resolve(split, "AGENTS.override.md"), "\n", "utf8");
    await writeFile(resolve(split, "AGENTS.md"), "x".repeat(32 * 1024 + 1), "utf8");
    assert.deepEqual(await codes(split), [["INSTRUCTION-BUDGET", "AGENTS.md"]]);
  });

  it("flags a different package manager and shows both files and the line", async () => {
    const root = await repo("Install with `pnpm install`.\n");
    await writeFile(resolve(root, "GEMINI.md"), "# Gemini\nRun `npm ci` first.\n", "utf8");
    const [finding] = await checkInstructions(root);
    assert.equal(finding.code, "INSTRUCTION-CONFLICT");
    assert.equal(finding.level, "warning");
    assert.equal(finding.file, "GEMINI.md");
    assert.match(
      finding.message,
      /npm \(line 2: "Run `npm ci` first\."\).*pnpm in AGENTS\.md \(line 1/,
    );
  });

  it("flags a different test runner", async () => {
    const root = await repo("Tests: `vitest run`.\n");
    await writeFile(resolve(root, "GEMINI.md"), "Tests: `jest`.\n", "utf8");
    const [finding] = await checkInstructions(root);
    assert.equal(finding.code, "INSTRUCTION-CONFLICT");
    assert.match(finding.message, /test runner jest .* vitest/);
  });

  it("raises no alarm for the same command written differently, fenced blocks, or one file's own mix", async () => {
    const root = await repo(
      "Use `npm test`.\n\n```sh\npnpm install\n```\nDo not use yarn here.\nBoth `npm run build` and `bun run build` work.\n",
    );
    await writeFile(
      resolve(root, "GEMINI.md"),
      "Run `npm run test` or `vitest`.\n```\nyarn test\n```\n",
      "utf8",
    );
    await writeFile(resolve(root, "CLAUDE.md"), "Prefer `pnpm test`; never npm.\n", "utf8");
    assert.deepEqual(await checkInstructions(root), []);
  });

  it("skips bridge-generated files: they are AGENTS.md", async () => {
    const root = await repo("Run `npm test`.\n");
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    assert.deepEqual(await checkInstructions(root), []);
  });

  it("counts both rules in status", async () => {
    const root = await tempDir();
    dirs.push(root);
    const input = manifest();
    await writeFiles(root, generateFiles(input).files);
    await writeManifest(root, input);
    await writeFile(
      resolve(root, "AGENTS.md"),
      `Use \`npm ci\`.\n${"x".repeat(33 * 1024)}`,
      "utf8",
    );
    await writeFile(resolve(root, "GEMINI.md"), "Use `yarn add`.\n", "utf8");
    const status = await collectStatus(root);
    assert.equal(status.instructionDrift, 2);
    assert.equal(status.doctor.ok, true);
  });
});

describe("bridge end to end", () => {
  it("doctor fails on diverged files, bridge --write makes it clean", async () => {
    const root = await repo("# Rules\n\nRun `npm test`.\n");
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    await writeFile(
      resolve(root, "CLAUDE.md"),
      "<!-- vulcanus:bridge source=AGENTS.md -->\nOld rules, no import.\n",
      "utf8",
    );
    assert.equal(await quietly(() => doctorCommand({ cwd: root })), 1);
    assert.deepEqual(await checkInstructions(root), [
      {
        level: "error",
        code: "INSTRUCTION-SOURCE",
        message: "no longer imports AGENTS.md; run `vulcanus bridge --write`",
        file: "CLAUDE.md",
      },
    ]);

    assert.equal(await quietly(() => bridgeCommand({ cwd: root, write: true })), 0);
    assert.equal(await quietly(() => doctorCommand({ cwd: root })), 0);
    assert.deepEqual(await checkInstructions(root), []);
  });
});
