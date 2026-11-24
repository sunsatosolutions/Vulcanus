import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { collectStale, staleCommand } from "../src/commands/stale.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { writeManifest } from "../src/manifest/io.js";
import { validateManifest } from "../src/manifest/schema.js";
import { parseSections } from "../src/memory/lifecycle.js";
import {
  headLine,
  latestChange,
  parseBlame,
  parseDiffHunks,
  type StaleReport,
} from "../src/memory/staleness.js";
import { buildProgram } from "../src/program.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

const NOW = new Date("2026-11-24T12:00:00Z");

function git(root: string, args: string[], date?: string): void {
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}),
    },
  });
}

function commit(root: string, date: string, message = "change"): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message], date);
}

const DECISIONS = [
  "# Meridian Decisions",
  "",
  "## Old Live",
  "",
  "Kept as is.",
  "",
  "## Replaced",
  "",
  "superseded-by:: [[Meridian Decisions#Old Live]]",
  "",
  "Gone.",
  "",
  "## Lapsed",
  "",
  "valid-until:: 2020-01-01",
  "",
  "Expired.",
  "",
  "## Timeless",
  "",
  "evergreen:: true",
  "",
  "Always true.",
  "",
].join("\n");

async function scaffold(options: { git?: boolean; staleDays?: number } = {}) {
  const input = manifest({
    projects: [project("meridian", "Meridian"), project("kiln", "Kiln")],
    ...(options.staleDays === undefined ? {} : { staleDays: options.staleDays }),
  });
  const root = await tempDir();
  tempDirs.push(root);
  const { files } = generateFiles(input);
  await writeFiles(root, files);
  await writeManifest(root, input);
  const plan = buildPlan(input);
  const meridian = plan.allProjects.find((entry) => entry.project.id === "meridian")!;
  const kiln = plan.allProjects.find((entry) => entry.project.id === "kiln")!;
  await writeFile(resolve(root, meridian.decisions.path), DECISIONS);
  await writeFile(resolve(root, meridian.rules.path), "# Meridian Rules\n\n## Old Rule\n\nText.\n");
  if (options.git !== false) {
    git(root, ["init", "-q"]);
    commit(root, "2026-01-01T12:00:00Z", "initial");
    // Meridian moves on: one decision is rewritten recently, Kiln stays still.
    await appendFile(resolve(root, meridian.decisions.path), "\n## Fresh\n\nNew.\n");
    commit(root, "2026-10-30T12:00:00Z", "fresh decision");
  }
  return { root, meridian, kiln };
}

async function runJson(root: string, days?: string) {
  const out: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => (out.push(chunk), true);
  let code: number;
  try {
    code = await staleCommand({ cwd: root, json: true, days, now: NOW });
  } finally {
    process.stdout.write = original;
  }
  return { code, parsed: JSON.parse(out.join("")) as StaleReport };
}

async function report(root: string, days: number) {
  return collectStale(root, days, NOW);
}

describe("vulcanus stale", () => {
  it("lists what is past the threshold, oldest first, and skips what is younger", async () => {
    const { root, meridian } = await scaffold();
    const result = await report(root, 90);

    const names = result.stale.map((entry) => entry.heading ?? entry.note);
    assert.ok(names.includes("Old Live"));
    assert.ok(names.includes("Old Rule"));
    assert.ok(!names.includes("Fresh"), "25 days old is under 90");

    const oldLive = result.stale.find((entry) => entry.heading === "Old Live")!;
    assert.equal(oldLive.kind, "decision");
    assert.equal(oldLive.project, "Meridian");
    assert.equal(oldLive.note, meridian.decisions.path);
    assert.equal(oldLive.lastChanged, "2026-01-01");
    assert.equal(oldLive.ageDays, 327);
    assert.equal(oldLive.projectLastActivity, "2026-10-30");

    const ages = result.stale.map((entry) => entry.ageDays!);
    assert.deepEqual(
      ages,
      [...ages].sort((a, b) => b - a),
    );
  });

  it("lists capsules, dated as a whole, with their project's last activity", async () => {
    const { root, kiln } = await scaffold();
    const result = await report(root, 90);
    const capsule = result.stale.find((entry) => entry.note === kiln.capsule.path)!;
    assert.equal(capsule.kind, "capsule");
    assert.equal(capsule.heading, null);
    assert.equal(capsule.projectLastActivity, "2026-01-01");
  });

  it("skips superseded, expired, and evergreen sections", async () => {
    const { root } = await scaffold();
    const headings = (await report(root, 0)).stale.map((entry) => entry.heading);
    for (const hidden of ["Replaced", "Lapsed", "Timeless"]) {
      assert.ok(!headings.includes(hidden), `${hidden} must not be listed`);
    }
  });

  it("applies the threshold as strictly older than", async () => {
    const { root } = await scaffold();
    assert.ok((await report(root, 326)).stale.some((entry) => entry.heading === "Old Live"));
    assert.ok(!(await report(root, 327)).stale.some((entry) => entry.heading === "Old Live"));
  });

  it("reports an uncommitted line as unknown, not as old or new", async () => {
    const { root, meridian } = await scaffold();
    await appendFile(resolve(root, meridian.decisions.path), "\n## Draft\n\nNot committed.\n");
    await appendFile(resolve(root, meridian.rules.path), "\nEdited after the commit.\n");
    const result = await report(root, 90);
    const unknown = result.unknown.map((entry) => entry.heading);
    assert.ok(unknown.includes("Draft"));
    assert.ok(unknown.includes("Old Rule"), "an edited, uncommitted section cannot be dated");
    assert.ok(!result.stale.some((entry) => entry.heading === "Draft"));
    assert.equal(result.unknown[0].lastChanged, null);
    assert.equal(result.unknown[0].ageDays, null);
  });

  it("never falls back to mtime: a vault without git history is all unknown", async () => {
    const { root } = await scaffold({ git: false });
    const result = await report(root, 0);
    assert.equal(result.stale.length, 0);
    assert.ok(result.unknown.length > 0);
    assert.ok(result.unknown.every((entry) => entry.projectLastActivity === null));
  });

  it("reads the threshold from --days, then vulcanus.json, then 90", async () => {
    const { root } = await scaffold({ staleDays: 400 });
    assert.equal((await runJson(root)).parsed.days, 400);
    assert.equal(
      (await runJson(root)).parsed.stale.length,
      0,
      "327 days is under the manifest's 400",
    );
    const override = (await runJson(root, "30")).parsed;
    assert.equal(override.days, 30);
    assert.ok(override.stale.length > 0);
  });

  it("keeps the --json shape fixed and exits 0 even when records are found", async () => {
    const { root } = await scaffold();
    const { code, parsed } = await runJson(root);
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(parsed), ["days", "stale", "unknown"]);
    assert.ok(parsed.stale.length > 0);
    assert.deepEqual(Object.keys(parsed.stale[0]), [
      "project",
      "kind",
      "note",
      "heading",
      "lastChanged",
      "ageDays",
      "projectLastActivity",
    ]);
  });

  it("exits 2 on misuse: bad --days, no vault", async () => {
    const { root } = await scaffold();
    const stderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      for (const days of ["abc", "-5", "1.5", ""]) {
        assert.equal(await staleCommand({ cwd: root, days }), 2, `--days ${days}`);
      }
      const empty = await tempDir();
      tempDirs.push(empty);
      assert.equal(await staleCommand({ cwd: empty }), 2);
    } finally {
      process.stderr.write = stderr;
    }
  });

  it("rejects a bad staleDays in the manifest", () => {
    const issues = validateManifest(manifest({ staleDays: -1 }));
    assert.ok(issues.some((issue) => issue.level === "error" && /staleDays/.test(issue.message)));
    assert.deepEqual(
      validateManifest(manifest({ staleDays: 30 })).filter((issue) =>
        /staleDays/.test(issue.message),
      ),
      [],
    );
  });

  it("is registered on the command tree", () => {
    assert.ok(buildProgram().commands.some((command) => command.name() === "stale"));
  });
});

describe("staleness helpers", () => {
  it("reads evergreen:: as a lifecycle field", () => {
    const [on, off] = parseSections("a.md", "## A\n\nevergreen:: true\n\n## B\n\nevergreen:: no\n");
    assert.equal(on.evergreen, true);
    assert.equal(off.evergreen, false);
  });

  it("dates a section by a committed line deletion, not by the lines left", async () => {
    const { root, meridian, kiln } = await scaffold();
    const decisions = resolve(root, meridian.decisions.path);
    const capsule = resolve(root, kiln.capsule.path);
    const decisionsBefore = await readFile(decisions, "utf8");
    const capsuleBefore = await readFile(capsule, "utf8");
    await writeFile(
      decisions,
      decisionsBefore.replace("Kept as is.\n", "Kept as is.\nExtra line.\n"),
    );
    await writeFile(capsule, `${capsuleBefore}Extra line.\n`);
    commit(root, "2026-11-01T12:00:00Z", "add lines");
    await writeFile(decisions, decisionsBefore);
    await writeFile(capsule, capsuleBefore);
    commit(root, "2026-11-23T12:00:00Z", "drop lines");

    const result = await report(root, 90);
    assert.ok(!result.stale.some((e) => e.heading === "Old Live"), "deleted 1 day ago");
    assert.ok(!result.stale.some((e) => e.note === kiln.capsule.path), "capsule edited 1 day ago");
    const rule = result.stale.find((e) => e.heading === "Old Rule")!;
    assert.equal(rule.lastChanged, "2026-01-01", "an untouched neighbour keeps its date");
  });

  it("reports a section with an uncommitted line deletion as unknown", async () => {
    const { root, meridian, kiln } = await scaffold();
    const decisions = resolve(root, meridian.decisions.path);
    const capsule = resolve(root, kiln.capsule.path);
    await writeFile(decisions, (await readFile(decisions, "utf8")).replace("Kept as is.\n", ""));
    await writeFile(
      capsule,
      (await readFile(capsule, "utf8")).split("\n").slice(0, -2).join("\n") + "\n",
    );

    const result = await report(root, 90);
    assert.ok(result.unknown.some((e) => e.heading === "Old Live"));
    assert.ok(!result.stale.some((e) => e.heading === "Old Live"));
    assert.ok(result.unknown.some((e) => e.note === kiln.capsule.path));
    assert.ok(
      result.stale.some((e) => e.heading === "Old Rule"),
      "other notes are unaffected",
    );
  });

  it("parses blame and treats the all-zero hash as uncommitted", () => {
    const hash = "a".repeat(40);
    const zero = "0".repeat(40);
    const porcelain = [
      `${hash} 1 1 1`,
      "committer-time 1000",
      "summary x",
      "\ttext",
      `${zero} 2 2 1`,
      "committer-time 9999",
      "\t",
      `${zero} 3 3 1`,
      "committer-time 9999",
      "\tdraft",
      "",
    ].join("\n");
    const blame = parseBlame(porcelain);
    assert.deepEqual(blame, [
      { time: 1000, blank: false },
      { time: null, blank: true },
      { time: null, blank: false },
    ]);
    assert.equal(latestChange(blame, 1, 2), 1000, "an uncommitted blank line is ignored");
    assert.equal(latestChange(blame, 1, 3), null);
  });
});

describe("diff hunks", () => {
  it("maps working-tree lines back to HEAD lines", () => {
    const hunks = parseDiffHunks("@@ -0,0 +1,2 @@\n+a\n+b\n@@ -7 +8,0 @@ m1\n-m2\n");
    assert.deepEqual(hunks[1], { oldStart: 7, oldCount: 1, newStart: 8, newCount: 0 });
    assert.equal(headLine(hunks, 5), 3);
    assert.equal(headLine(hunks, 9), 8);
  });
});
