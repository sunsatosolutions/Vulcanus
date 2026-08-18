import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { wireHubs } from "../src/generate/wire.js";
import { runDoctor } from "../src/doctor/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { validateManifest } from "../src/manifest/schema.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];

async function scaffold(input = manifest()) {
  const root = await tempDir();
  tempDirs.push(root);
  const { files, plan } = generateFiles(input);
  await writeFiles(root, files);
  return { root, plan, manifest: input };
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

/** Findings for one file, so an assertion names the file it means. */
function findingsFor(
  report: Awaited<ReturnType<typeof runDoctor>>,
  code: string,
  file: string,
): string[] {
  return report.findings
    .filter((finding) => finding.code === code && finding.file === file)
    .map((finding) => finding.message);
}

describe("hub links outside the navigation list", () => {
  const input = manifest({
    projects: [project("northwind", "Northwind"), project("lumen", "Lumen")],
  });

  it("leaves prose that points at another project alone", async () => {
    const { root, plan } = await scaffold(input);
    const hubPath = plan.allProjects.find((entry) => entry.project.id === "northwind")!.hub.path;
    const absolute = resolve(root, hubPath);

    const original = await readFile(absolute, "utf8");
    await writeFile(
      absolute,
      `${original}\n## Ownership\n\n- Lumen is a client's product and lives under [[Lumen Hub]].\n`,
      "utf8",
    );

    const report = await runDoctor(root, input);
    assert.deepEqual(findingsFor(report, "HUB", hubPath), []);
  });

  it("still reports a link added to the navigation list itself", async () => {
    const { root, plan } = await scaffold(input);
    const hubPath = plan.allProjects.find((entry) => entry.project.id === "northwind")!.hub.path;
    const absolute = resolve(root, hubPath);

    const original = await readFile(absolute, "utf8");
    await writeFile(
      absolute,
      original.replace("## Core Files\n", "## Core Files\n\n- [[Lumen Hub]]\n"),
      "utf8",
    );

    const report = await runDoctor(root, input);
    const messages = findingsFor(report, "HUB", hubPath);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /lists beyond the manifest: Lumen Hub/);
  });
});

describe("system notes the operator declares", () => {
  const declared = manifest({ systemNotes: ["Release Notes"] });

  /** Only the issues about declared system notes; an empty vault warns anyway. */
  const noteIssues = (input: Parameters<typeof validateManifest>[0]) =>
    validateManifest(input).filter((issue) => /system note|systemNotes/.test(issue.message));

  it("accepts a name the generator does not already own", () => {
    assert.deepEqual(noteIssues(declared), []);
  });

  it("rejects one that collides with a generated note, and duplicates", () => {
    const collision = noteIssues(manifest({ systemNotes: ["Changelog"] }));
    assert.equal(collision.length, 1);
    assert.match(collision[0].message, /already generates/);

    const duplicate = noteIssues(manifest({ systemNotes: ["Notes", "notes"] }));
    assert.equal(duplicate.length, 1);
    assert.match(duplicate[0].message, /duplicate system note/);

    const empty = noteIssues(manifest({ systemNotes: ["  "] }));
    assert.equal(empty.length, 1);
    assert.match(empty[0].message, /empty name/);
  });

  it("brands the filename the same way a generated system note is branded", () => {
    const plan = buildPlan(declared);
    assert.deepEqual(
      plan.operatorNotes.map((note) => note.path),
      ["00_System/ATLAS Release Notes.md"],
    );
  });

  it("never writes the note itself", async () => {
    const { files } = generateFiles(declared);
    assert.equal(
      files.some((file) => file.path === "00_System/ATLAS Release Notes.md"),
      false,
    );
  });

  it("is not reported as unmanaged, and the System Hub may link it", async () => {
    const { root, plan } = await scaffold(declared);
    const notePath = plan.operatorNotes[0].path;
    await writeFile(
      resolve(root, notePath),
      "---\ntype: specialized\nstatus: active\n---\n\n# ATLAS Release Notes\n\nHub: [[System Hub]]\n",
      "utf8",
    );
    await wireHubs(root, plan);

    const report = await runDoctor(root, declared);
    assert.deepEqual(findingsFor(report, "UNMANAGED", notePath), []);
    assert.deepEqual(findingsFor(report, "HUB", plan.systemHub.path), []);

    const hub = await readFile(resolve(root, plan.systemHub.path), "utf8");
    assert.match(hub, /- \[\[ATLAS Release Notes\]\]/);
  });

  it("says so when a declared note was never written", async () => {
    const { root } = await scaffold(declared);
    const report = await runDoctor(root, declared);
    const messages = findingsFor(report, "UNMANAGED", "00_System/ATLAS Release Notes.md");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /declared in systemNotes but not present/);
  });

  it("still flags a system note nobody declared", async () => {
    const { root } = await scaffold();
    const stray = "00_System/Stray Thought.md";
    await writeFile(
      resolve(root, stray),
      "---\ntype: specialized\nstatus: active\n---\n\n# Stray Thought\n",
      "utf8",
    );

    const report = await runDoctor(root, manifest());
    assert.equal(findingsFor(report, "UNMANAGED", stray).length, 1);
  });
});
