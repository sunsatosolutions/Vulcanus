import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { doctorCommand } from "../src/commands/doctor.js";
import {
  archiveProjectCommand,
  removeProjectCommand,
  renameProjectCommand,
} from "../src/commands/project.js";
import { findStaleCapsules } from "../src/commands/status.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { removeBulletsLinking, removeSection } from "../src/generate/patch.js";
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

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

async function quiet<T>(action: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await action();
  } finally {
    process.stdout.write = original;
  }
}

describe("remove project", () => {
  it("archives the notes, unlinks the graph, and still validates", async () => {
    const input = manifest({
      projects: [project("meridian", "Meridian"), project("kiln", "Kiln")],
    });
    const root = await scaffold(input);

    const code = await quiet(() => removeProjectCommand("Meridian", { cwd: root }));
    assert.equal(code, 0);

    const written = await readManifest(root);
    assert.deepEqual(
      written.projects.map((entry) => entry.name),
      ["Kiln"],
    );

    // Notes were parked, not deleted.
    assert.ok(!existsSync(resolve(root, "02_Projects/Meridian")));
    assert.ok(existsSync(resolve(root, "_archive/Meridian/Meridian Capsule.md")));

    // The recall map no longer routes to it.
    const recall = await readFile(resolve(root, "00_System/ATLAS Recall Map.md"), "utf8");
    assert.ok(!recall.includes("### Meridian"));
    assert.ok(!recall.includes("[[Meridian Capsule]]"));

    assert.equal(await quiet(() => doctorCommand({ cwd: root, json: true })), 0);
  });

  it("unlinks a sub-project from its parent hub", async () => {
    const input = manifest({
      projects: [
        project("northwind", "Northwind"),
        project("harbor", "Harbor", { parent: "northwind" }),
      ],
    });
    const root = await scaffold(input);

    const code = await quiet(() => removeProjectCommand("Harbor", { cwd: root }));
    assert.equal(code, 0);

    const hub = await readFile(resolve(root, "02_Projects/Northwind/Northwind Hub.md"), "utf8");
    assert.ok(!hub.includes("[[Harbor Hub]]"));
    assert.equal(await quiet(() => doctorCommand({ cwd: root, json: true })), 0);
  });

  it("refuses while sub-projects still exist, and on unknown names", async () => {
    const input = manifest({
      projects: [
        project("northwind", "Northwind"),
        project("harbor", "Harbor", { parent: "northwind" }),
      ],
    });
    const root = await scaffold(input);

    assert.equal(await quiet(() => removeProjectCommand("Northwind", { cwd: root })), 2);
    assert.equal(await quiet(() => removeProjectCommand("Ghost", { cwd: root })), 2);
    assert.equal((await readManifest(root)).projects.length, 2);
  });
});

describe("rename project", () => {
  it("moves the folder, renames the notes, and rewrites every link", async () => {
    const input = manifest({
      projects: [project("meridian", "Meridian"), project("kiln", "Kiln")],
    });
    const root = await scaffold(input);

    const code = await quiet(() => renameProjectCommand("Meridian", "Beacon", { cwd: root }));
    assert.equal(code, 0);

    const written = await readManifest(root);
    assert.deepEqual(written.projects.map((entry) => entry.name).sort(), ["Beacon", "Kiln"]);

    assert.ok(!existsSync(resolve(root, "02_Projects/Meridian")));
    assert.ok(existsSync(resolve(root, "02_Projects/Beacon/Beacon Capsule.md")));

    const recall = await readFile(resolve(root, "00_System/ATLAS Recall Map.md"), "utf8");
    assert.ok(recall.includes("### Beacon"));
    assert.ok(recall.includes("[[Beacon Capsule]]"));
    assert.ok(!recall.includes("Meridian"));

    assert.equal(await quiet(() => doctorCommand({ cwd: root, json: true })), 0);
  });

  it("renames a parent without breaking its children", async () => {
    const input = manifest({
      projects: [
        project("northwind", "Northwind"),
        project("harbor", "Harbor", { parent: "northwind" }),
      ],
    });
    const root = await scaffold(input);

    const code = await quiet(() => renameProjectCommand("Northwind", "Southsea", { cwd: root }));
    assert.equal(code, 0);

    assert.ok(existsSync(resolve(root, "02_Projects/Southsea/Harbor/Harbor Capsule.md")));
    const harborHub = await readFile(
      resolve(root, "02_Projects/Southsea/Harbor/Harbor Hub.md"),
      "utf8",
    );
    assert.ok(harborHub.includes("[[Southsea Hub]]"));

    assert.equal(await quiet(() => doctorCommand({ cwd: root, json: true })), 0);
  });

  it("refuses a collision or an unusable name", async () => {
    const input = manifest({
      projects: [project("meridian", "Meridian"), project("kiln", "Kiln")],
    });
    const root = await scaffold(input);

    assert.equal(await quiet(() => renameProjectCommand("Meridian", "Kiln", { cwd: root })), 2);
    assert.equal(await quiet(() => renameProjectCommand("Meridian", "   ", { cwd: root })), 2);
  });
});

describe("archive project", () => {
  it("flips the status both ways without touching notes", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const root = await scaffold(input);

    assert.equal(await quiet(() => archiveProjectCommand("Meridian", { cwd: root })), 0);
    assert.equal((await readManifest(root)).projects[0].status, "archived");
    assert.ok(existsSync(resolve(root, "02_Projects/Meridian/Meridian Capsule.md")));

    assert.equal(
      await quiet(() => archiveProjectCommand("Meridian", { cwd: root, restore: true })),
      0,
    );
    assert.equal((await readManifest(root)).projects[0].status, "active");

    assert.equal(await quiet(() => doctorCommand({ cwd: root, json: true })), 0);
  });
});

describe("capsule freshness", () => {
  it("flags a capsule older than the decisions it summarizes", async () => {
    const input = manifest({
      projects: [project("meridian", "Meridian"), project("kiln", "Kiln")],
    });
    const root = await scaffold(input);
    const plan = buildPlan(input);

    assert.deepEqual(await findStaleCapsules(root, plan), []);

    // Decisions move on; the capsule stays where it was.
    const decisions = resolve(root, "02_Projects/Meridian/Meridian Decisions.md");
    await writeFile(decisions, `${await readFile(decisions, "utf8")}\nNew decision.\n`, "utf8");
    const future = new Date(Date.now() + 60_000);
    await utimes(decisions, future, future);

    const stale = await findStaleCapsules(root, plan);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].project, "Meridian");
    assert.deepEqual(stale[0].changedSince, ["Meridian Decisions"]);
  });
});

describe("surgical markdown removal", () => {
  it("removes a section up to the next same-level heading", () => {
    const content = ["## A", "", "### One", "", "- x", "", "### Two", "", "- y", ""].join("\n");
    const result = removeSection(content, "### One");
    assert.equal(result.changed, true);
    assert.ok(!result.content.includes("### One"));
    assert.ok(!result.content.includes("- x"));
    assert.ok(result.content.includes("### Two"));
    assert.ok(result.content.includes("- y"));
  });

  it("drops only bullets linking to the given names", () => {
    const content = ["- [[Keep Hub]]", "- [[Drop Hub]]", "- plain text [[Drop Hub]]"].join("\n");
    const result = removeBulletsLinking(content, ["Drop Hub"]);
    assert.equal(result.changed, true);
    assert.equal(result.content, "- [[Keep Hub]]");
  });
});
