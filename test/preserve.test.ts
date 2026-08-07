import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { applyProjects } from "../src/commands/add.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { updateCommand } from "../src/commands/update.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { mergeProtocol, splitSections } from "../src/generate/merge.js";
import { wireHubs } from "../src/generate/wire.js";
import { buildPlan } from "../src/manifest/derive.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];

async function scaffold(input = manifest()) {
  const root = await tempDir();
  tempDirs.push(root);
  const { files } = generateFiles(input);
  await writeFiles(root, files);
  await writeManifest(root, input);
  return root;
}

async function quiet<T>(action: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await action();
  } finally {
    process.stdout.write = original;
  }
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

/**
 * 0.4.0 regenerated the Index, the hubs, and the Import Log on every update,
 * deleting whatever the operator had written in them. These tests pin the fix:
 * a file holding memory is never rewritten, and the graph is kept correct by
 * inserting what is missing instead.
 */
describe("operator content survives an update", () => {
  const OPERATOR_FILES = [
    "00_System/ATLAS Index.md",
    "00_System/System Hub.md",
    "00_System/ATLAS Import Log.md",
  ];

  it("leaves every operator-writable file untouched", async () => {
    const input = manifest({
      generator: { name: "vulcanus", version: "0.0.1" },
      projects: [project("meridian", "Meridian")],
    });
    const root = await scaffold(input);

    const marked = new Map<string, string>();
    for (const path of OPERATOR_FILES) {
      const absolute = resolve(root, path);
      const content = `${await readFile(absolute, "utf8")}\n## Operator Section\n\nWritten by hand.\n`;
      await writeFile(absolute, content, "utf8");
      marked.set(path, content);
    }

    assert.equal(await quiet(() => updateCommand({ cwd: root, json: true })), 0);

    for (const [path, expected] of marked) {
      assert.equal(
        await readFile(resolve(root, path), "utf8"),
        expected,
        `${path} must not be rewritten by update`,
      );
    }
  });

  it("survives doctor --repair too", async () => {
    const root = await scaffold(manifest({ projects: [project("meridian", "Meridian")] }));
    const logPath = resolve(root, "00_System/ATLAS Import Log.md");
    const written = `${await readFile(logPath, "utf8")}\n## 2026-01-01 — my own import\n\n1,515 conversations.\n`;
    await writeFile(logPath, written, "utf8");

    assert.equal(await quiet(() => doctorCommand({ cwd: root, repair: true, json: true })), 0);
    assert.equal(await readFile(logPath, "utf8"), written);
  });

  it("still deepens the system layer, by linking rather than rewriting", async () => {
    const input = manifest({
      generator: { name: "vulcanus", version: "0.0.1" },
      projects: [project("northwind", "Northwind")],
    });
    const root = await scaffold(input);

    const hubPath = resolve(root, "00_System/System Hub.md");
    const edited = `${await readFile(hubPath, "utf8")}\n## House Rules\n\nMine.\n`;
    await writeFile(hubPath, edited, "utf8");

    assert.equal(await quiet(() => updateCommand({ cwd: root, profile: "full", json: true })), 0);

    // The new system notes exist and the hub links to them…
    assert.ok(existsSync(resolve(root, "00_System/ATLAS Brain OS Architecture.md")));
    const hub = await readFile(hubPath, "utf8");
    assert.match(hub, /\[\[ATLAS Brain OS Architecture\]\]/);
    // …and the operator's section is still there.
    assert.match(hub, /## House Rules/);
    assert.match(hub, /Mine\./);

    const report = await runDoctor(root, await readManifest(root));
    assert.equal(report.counts.error, 0);
  });
});

describe("wiring hubs without rewriting them", () => {
  it("inserts only the missing links", async () => {
    const root = await scaffold(manifest({ projects: [project("meridian", "Meridian")] }));
    const plan = buildPlan(await readManifest(root));

    const hubPath = resolve(root, "00_System/System Hub.md");
    const stripped = (await readFile(hubPath, "utf8")).replace(/^- \[\[ATLAS Rules\]\]\n/m, "");
    await writeFile(hubPath, stripped, "utf8");

    const patched = await wireHubs(root, plan);
    assert.deepEqual(patched, ["00_System/System Hub.md"]);

    const repaired = await readFile(hubPath, "utf8");
    assert.match(repaired, /\[\[ATLAS Rules\]\]/);
    // Nothing else moved: the file is the stripped one plus a single line.
    assert.equal(repaired.split("\n").length, stripped.split("\n").length + 1);
  });

  it("does nothing when every link is already there", async () => {
    const root = await scaffold(manifest({ projects: [project("meridian", "Meridian")] }));
    assert.deepEqual(await wireHubs(root, buildPlan(await readManifest(root))), []);
  });
});

describe("adding a project to hand-edited navigation", () => {
  it("links the new project in without touching what the operator wrote", async () => {
    const input = manifest({
      groups: [{ id: "branding", name: "Branding", summary: "", navigationOnly: true }],
      projects: [project("meridian", "Meridian", { group: "branding" })],
    });
    const root = await scaffold(input);

    const indexPath = resolve(root, "00_System/ATLAS Index.md");
    const groupHubPath = resolve(root, "02_Projects/Branding Hub.md");
    const marker = "## My Notes\n\nDo not delete me.\n";
    await writeFile(indexPath, `${await readFile(indexPath, "utf8")}\n${marker}`, "utf8");
    await writeFile(groupHubPath, `${await readFile(groupHubPath, "utf8")}\n${marker}`, "utf8");

    const result = await quiet(() =>
      applyProjects(root, input, {
        projects: [
          project("harbor", "Harbor", { group: "branding", summary: "Harbor pricing and launch." }),
          project("kiln", "Kiln", { summary: "Kiln firing schedules." }),
        ],
        groups: [],
      }),
    );
    assert.equal(result.ok, true);

    const index = await readFile(indexPath, "utf8");
    assert.match(index, /## My Notes/);
    assert.match(index, /Do not delete me\./);
    // A top-level project reaches the Index directly, with the summary the
    // operator just gave; a grouped one arrives through its group hub.
    assert.match(index, /\[\[Kiln Hub\]\]/);
    assert.match(index, /### Kiln/);
    assert.match(index, /Kiln firing schedules\./);

    const groupHub = await readFile(groupHubPath, "utf8");
    assert.match(groupHub, /## My Notes/);
    assert.match(groupHub, /\[\[Harbor Hub\]\]/);

    const report = await runDoctor(root, await readManifest(root));
    assert.equal(report.counts.error, 0);
  });
});

describe("AGENTS.md merging", () => {
  it("splits a document on its top-level headings", () => {
    const sections = splitSections("# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n");
    assert.deepEqual(
      sections.map((section) => section.heading),
      [null, "One", "Two"],
    );
    assert.match(sections[0].body, /# Title/);
  });

  it("keeps the operator's sections and adds the ones they lack", () => {
    const existing = "# My Protocol\n\n## Required workflow\n\nMy own steps.\n";
    const generated =
      "# Generated\n<!-- vulcanus:protocol 1 -->\n\n## Required workflow\n\nDefault steps.\n\n## Safety\n\nBe careful.\n";

    const merged = mergeProtocol(existing, generated);

    assert.match(merged, /# My Protocol/);
    assert.match(merged, /My own steps\./);
    assert.ok(!merged.includes("Default steps."), "an existing section is never replaced");
    assert.match(merged, /## Safety/);
    assert.match(merged, /Be careful\./);
    assert.match(merged, /<!-- vulcanus:protocol 1 -->/);
  });

  it("refreshes an outdated protocol stamp in place", () => {
    const existing = "# P\n<!-- vulcanus:protocol 0 -->\n\n## A\n\nx\n";
    const merged = mergeProtocol(existing, "# G\n<!-- vulcanus:protocol 3 -->\n\n## A\n\ny\n");
    assert.match(merged, /<!-- vulcanus:protocol 3 -->/);
    assert.ok(!merged.includes("protocol 0"));
  });

  it("merges through a real update, keeping the operator's step", async () => {
    const input = manifest({ generator: { name: "vulcanus", version: "0.0.1" } });
    const root = await scaffold(input);

    const agentsPath = resolve(root, "AGENTS.md");
    const custom = "# House Protocol\n\n## Required workflow\n\nRun our health check first.\n";
    await writeFile(agentsPath, custom, "utf8");

    assert.equal(await quiet(() => updateCommand({ cwd: root, json: true })), 0);

    const merged = await readFile(agentsPath, "utf8");
    assert.match(merged, /# House Protocol/);
    assert.match(merged, /Run our health check first\./);
    // The protocol's own sections arrive, and the stamp lets doctor see it.
    assert.match(merged, /## Durable memory boundary/);
    assert.match(merged, /<!-- vulcanus:protocol \d+ -->/);
  });

  it("still rewrites AGENTS.md when --force is asked for", async () => {
    const root = await scaffold(manifest({ generator: { name: "vulcanus", version: "0.0.1" } }));
    const agentsPath = resolve(root, "AGENTS.md");
    await writeFile(agentsPath, "# Mine\n\n## Required workflow\n\nOnly mine.\n", "utf8");

    assert.equal(await quiet(() => updateCommand({ cwd: root, force: true, json: true })), 0);
    const rewritten = await readFile(agentsPath, "utf8");
    assert.ok(!rewritten.includes("Only mine."), "--force means rewrite, and says so");
  });
});
