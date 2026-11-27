import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildExtractDigest } from "../src/ai/extract.js";
import { importCommand } from "../src/commands/import.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { maskConversation } from "../src/importers/mask.js";
import { writeManifest } from "../src/manifest/io.js";
import { appendDecision, appendRule, openVault, updateCapsule } from "../src/mcp/tools.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

// Built at run time: no token-shaped text sits in the repo.
const KEY = `${["AK", "IA"].join("")}${"7Q2".repeat(6).slice(0, 16)}`;
const MASK = "‹secret:aws-key›";

const tempDirs: string[] = [];
before(() => setLogLevel("quiet"));
after(async () => {
  setLogLevel("normal");
  for (const dir of tempDirs) await cleanup(dir);
});

const INPUT = manifest({ projects: [project("meridian", "Meridian")] });
const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const RULES = "02_Projects/Meridian/Meridian Rules.md";
const CAPSULE = "02_Projects/Meridian/Meridian Capsule.md";

async function scaffold() {
  const root = await tempDir();
  tempDirs.push(root);
  await writeFiles(root, generateFiles(INPUT).files);
  await writeManifest(root, INPUT);
  return root;
}

/** Every file under `dir`, with its text. */
async function everything(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(path, await readFile(path, "utf8"));
  }
  return out;
}

function driverFor(select: string[]): { driver: PromptDriver; shown: string[] } {
  const shown: string[] = [];
  const answers = [...select];
  const driver = {
    select: async (options: { message: string }) => {
      shown.push(options.message);
      return answers.shift();
    },
    text: async (options: { initialValue?: string }) => {
      shown.push(options.initialValue ?? "");
      return "";
    },
    confirm: async () => false,
    multiselect: async () => [],
  } as unknown as PromptDriver;
  return { driver, shown };
}

async function importNotes(root: string, sentence: string) {
  const notes = await tempDir();
  tempDirs.push(notes);
  await mkdir(join(notes, "Meridian"), { recursive: true });
  await writeFile(join(notes, "Meridian", "deploy.md"), `# Deploy call\n\n${sentence}\n`);
  const { driver, shown } = driverFor(["decision"]);
  const restore = setPromptDriver(driver);
  const out: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => (out.push(String(chunk)), true);
  try {
    const code = await importCommand({
      cwd: root,
      source: "markdown",
      path: notes,
      memoryOnly: true,
    });
    assert.equal(code, 0);
  } finally {
    process.stdout.write = write;
    restore();
  }
  return { shown, stdout: out.join("") };
}

describe("import masks secrets", () => {
  it("masks the candidate; the ledger and the note never hold the raw value", async () => {
    const root = await scaffold();
    const { shown } = await importNotes(
      root,
      `We decided ${KEY} is the Meridian deploy key from now on.`,
    );
    assert.ok(
      shown.some((line) => line.includes(MASK)),
      "the suggested title shows the mask",
    );

    const note = await readFile(resolve(root, DECISIONS), "utf8");
    assert.ok(note.includes(MASK), "the accepted note carries the mask");
    for (const [path, text] of await everything(root)) {
      assert.ok(!text.includes(KEY), `raw value found in ${path}`);
    }
  });

  it("keeps the raw value out of --json output", async () => {
    const root = await scaffold();
    const notes = await tempDir();
    tempDirs.push(notes);
    await writeFile(join(notes, `${KEY}.md`), `# Meridian ${KEY}\n\nWe decided to use ${KEY}.\n`);
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => (out.push(String(chunk)), true);
    try {
      await importCommand({ cwd: root, source: "markdown", path: notes, json: true });
      await importCommand({
        cwd: root,
        source: "markdown",
        path: notes,
        json: true,
        memoryOnly: true,
      });
    } finally {
      process.stdout.write = write;
    }
    assert.ok(out.join("").length > 0);
    assert.ok(!out.join("").includes(KEY));
  });

  it("masks the AI digest and every conversation field", () => {
    const masked = maskConversation({
      id: KEY,
      title: `t ${KEY}`,
      createdAt: null,
      updatedAt: null,
      source: "markdown",
      group: KEY,
      messages: [{ role: "user", text: `use ${KEY}` }],
    });
    assert.ok(!JSON.stringify(masked).includes(KEY));
    assert.equal(masked.messages[0].text, `use ${MASK}`);

    const digest = buildExtractDigest([
      {
        id: "c1",
        project: "Meridian",
        kind: "decision",
        text: `use ${KEY}`,
        correction: false,
        score: 3,
        conversations: 1,
        lastSeen: null,
        sources: [],
        sentenceIds: [],
      },
    ]);
    assert.equal(digest[0].text, `use ${MASK}`);
  });

  it("lets a clean statement through unchanged", async () => {
    const root = await scaffold();
    await importNotes(root, "We decided Meridian bills monthly per active seat.");
    assert.match(
      await readFile(resolve(root, DECISIONS), "utf8"),
      /### Decision\n\nWe decided Meridian bills monthly per active seat\./,
    );
  });
});

describe("MCP writes reject secrets", () => {
  async function unchanged(root: string, paths: string[], write: () => Promise<unknown>) {
    const before = await Promise.all(paths.map((path) => readFile(resolve(root, path), "utf8")));
    await assert.rejects(write, (error: Error) => {
      assert.match(error.message, /Refused to write/);
      assert.match(error.message, /aws-key/);
      assert.ok(!error.message.includes(KEY), "the value is not in the error");
      return true;
    });
    const after = await Promise.all(paths.map((path) => readFile(resolve(root, path), "utf8")));
    assert.deepEqual(after, before);
  }

  it("append_decision, in the decision, the title and the details", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await unchanged(root, [DECISIONS], () =>
      appendDecision(handle, "Meridian", "Deploy", `Use ${KEY} to deploy.`),
    );
    await unchanged(root, [DECISIONS], () =>
      appendDecision(handle, "Meridian", `Key ${KEY}`, "Fine."),
    );
    await unchanged(root, [DECISIONS], () =>
      appendDecision(handle, "Meridian", "Deploy", "Fine.", `see ${KEY}`),
    );
  });

  it("append_rule", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await unchanged(root, [RULES], () => appendRule(handle, "Meridian", "Keys", `Use ${KEY}.`));
  });

  it("update_capsule", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await unchanged(root, [CAPSULE], () =>
      updateCapsule(handle, "Meridian", "Identity", `Deploys with ${KEY}.`),
    );
  });

  it("clean input still writes", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    assert.ok(await appendDecision(handle, "Meridian", "Ship weekly", "Ships every Thursday."));
    assert.ok(await appendRule(handle, "Meridian", "Naming", "Use kebab-case."));
    assert.ok(await updateCapsule(handle, "Meridian", "Identity", "A navigation product."));
    assert.match(await readFile(resolve(root, DECISIONS), "utf8"), /Ships every Thursday\./);
    assert.match(await readFile(resolve(root, RULES), "utf8"), /Use kebab-case\./);
    assert.match(await readFile(resolve(root, CAPSULE), "utf8"), /A navigation product\./);
  });
});
