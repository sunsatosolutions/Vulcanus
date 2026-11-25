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
  });

  it("flags a copy whose body was edited though its marker hash is intact", async () => {
    const root = await repo();
    await quietly(() => bridgeCommand({ cwd: root, write: true }));
    const path = ".github/copilot-instructions.md";
    await writeFile(resolve(root, path), (await read(root, path)).replace("Be kind.", "Be rude."), "utf8");
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
