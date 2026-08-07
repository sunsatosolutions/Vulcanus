import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import {
  appendDecision,
  listProjects,
  matchProject,
  openVault,
  recall,
  search,
} from "../src/mcp/tools.js";
import { writeManifest } from "../src/manifest/io.js";
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

const INPUT = manifest({
  projects: [
    project("meridian", "Meridian", { triggers: ["meridian", "navigasyon"] }),
    project("kiln", "Kiln", { parent: "meridian" }),
  ],
});

describe("mcp vault tools", () => {
  it("matches a project by name, id, trigger, or mention", async () => {
    const root = await scaffold(INPUT);
    const handle = await openVault(root);

    assert.equal(matchProject(handle.plan, "Meridian")?.project.id, "meridian");
    assert.equal(matchProject(handle.plan, "KILN")?.project.id, "kiln");
    assert.equal(matchProject(handle.plan, "navigasyon")?.project.id, "meridian");
    assert.equal(matchProject(handle.plan, "fix the meridian sync bug")?.project.id, "meridian");
    assert.equal(matchProject(handle.plan, "unrelated"), undefined);
  });

  it("recall returns the capsule content and the protocol read order", async () => {
    const root = await scaffold(INPUT);
    const handle = await openVault(root);

    const result = await recall(handle, "meridian");
    assert.ok(result);
    assert.equal(result.project, "Meridian");
    assert.match(result.capsule.content, /# Meridian Capsule/);
    assert.deepEqual(
      result.readNext.map((note) => note.name),
      ["Meridian Hub", "Meridian Decisions", "Meridian Rules", "Meridian Context"],
    );

    assert.equal(await recall(handle, "ghost"), null);
  });

  it("search ranks capsule and recall-map hits above depth notes", async () => {
    const root = await scaffold(INPUT);
    const handle = await openVault(root);

    const hits = await search(handle, "Meridian");
    assert.ok(hits.length > 0);
    // The first hit comes from a weight-3 note (capsule or recall map).
    assert.equal(hits[0].weight, 3);
    assert.ok(hits.every((hit) => hit.text.toLowerCase().includes("meridian")));

    assert.deepEqual(await search(handle, "  "), []);
    assert.equal((await search(handle, "Meridian", 3)).length, 3);
  });

  it("append_decision writes the Decision/Details shape and keeps the vault valid", async () => {
    const root = await scaffold(INPUT);
    const handle = await openVault(root);

    const result = await appendDecision(
      handle,
      "meridian",
      "Ship weekly",
      "Meridian releases every Friday.",
      "Agreed with the operator on 2026-08-06.",
    );
    assert.ok(result);
    assert.equal(result.project, "Meridian");

    const decisions = await readFile(resolve(root, result.path), "utf8");
    assert.match(decisions, /## Ship weekly\n\n### Decision\n\nMeridian releases every Friday\./);
    assert.match(decisions, /### Details\n\nAgreed with the operator on 2026-08-06\./);

    const report = await runDoctor(root, handle.manifest);
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings));

    assert.equal(await appendDecision(handle, "ghost", "t", "d"), null);
  });

  it("list_projects exposes the routing table with hierarchy", async () => {
    const root = await scaffold(INPUT);
    const handle = await openVault(root);

    const listing = listProjects(handle);
    assert.deepEqual(
      listing.map((entry) => [entry.name, entry.parent]),
      [
        ["Meridian", null],
        ["Kiln", "Meridian"],
      ],
    );
    assert.ok(listing[0].triggers.includes("navigasyon"));
    assert.match(listing[1].capsule, /Kiln Capsule\.md$/);
  });
});
