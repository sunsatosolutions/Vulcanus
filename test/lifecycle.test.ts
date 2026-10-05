import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { repairLifecycle, runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import {
  analyzeLifecycle,
  headingKey,
  insertFields,
  isIsoDate,
  parseSections,
  sectionState,
  today,
} from "../src/memory/lifecycle.js";
import {
  appendDecision,
  appendRule,
  LifecycleTargetError,
  openVault,
  recall,
  search,
} from "../src/mcp/tools.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

const INPUT = manifest({ projects: [project("meridian", "Meridian")] });
const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const CAPSULE = "02_Projects/Meridian/Meridian Capsule.md";

async function scaffold() {
  const root = await tempDir();
  tempDirs.push(root);
  await writeFiles(root, generateFiles(INPUT).files);
  await writeManifest(root, INPUT);
  return root;
}

async function append(root: string, path: string, text: string) {
  const full = resolve(root, path);
  await writeFile(full, `${(await readFile(full, "utf8")).trimEnd()}\n${text}`, "utf8");
}

const read = (root: string, path: string) => readFile(resolve(root, path), "utf8");

describe("lifecycle parsing", () => {
  it("reads fields per section and ignores fences and comments", () => {
    const text = [
      "# Title",
      "",
      "## Usage Pricing",
      "",
      "supersedes:: [[Meridian Decisions#Flat Pricing]], [[#Trial]]",
      "source:: import · codex · 2026-09-14",
      "",
      "### Decision",
      "",
      "```md",
      "superseded-by:: [[Ignored#Inside Fence]]",
      "```",
      "<!--",
      "valid-until:: 1999-01-01",
      "-->",
      "",
      "## Flat Pricing",
      "superseded-by:: [[Meridian Decisions#Usage Pricing]]",
      "superseded-on:: 2026-10-05",
      "valid-until:: 2026-02-30",
    ].join("\r\n");

    const [usage, flat] = parseSections("x.md", text);
    assert.equal(usage.heading, "Usage Pricing");
    assert.deepEqual(
      usage.supersedes.map((link) => [link.note, link.heading]),
      [
        ["Meridian Decisions", "Flat Pricing"],
        ["", "Trial"],
      ],
    );
    assert.equal(usage.source, "import · codex · 2026-09-14");
    assert.equal(usage.supersededBy.length, 0);
    assert.equal(usage.validUntil, undefined);

    assert.equal(flat.supersededOn, "2026-10-05");
    assert.deepEqual(flat.badDates, ["valid-until:: 2026-02-30"]);
    assert.equal(sectionState(flat), "superseded");
    assert.equal(sectionState(usage), "live");
  });

  it("states expiry against the given day", () => {
    const [section] = parseSections("x.md", "## Promo\n\nvalid-until:: 2026-12-31\n");
    assert.equal(sectionState(section, "2026-12-31"), "live");
    assert.equal(sectionState(section, "2027-01-01"), "expired");
  });

  it("dates by the local calendar, not UTC", () => {
    // 00:30 local time on 5 October is still 4 October in UTC east of Greenwich.
    assert.equal(today(new Date(2026, 9, 5, 0, 30)), "2026-10-05");
  });

  it("validates real calendar dates only", () => {
    assert.ok(isIsoDate("2024-02-29"));
    assert.ok(!isIsoDate("2025-02-29"));
    assert.ok(!isIsoDate("2026-1-05"));
  });

  it("compares headings the way a reader would", () => {
    assert.equal(headingKey("  Flat   Pricing "), headingKey("flat pricing"));
    assert.equal(headingKey("A [draft] #1"), headingKey("A draft 1"));
  });

  it("inserts fields under the heading without moving anything else", () => {
    const text = "## Old\n\n### Decision\n\nKeep it.\n\n## Other\n\nBody.\n";
    const once = insertFields(text, "old", ["superseded-by:: [[N#New]]"]);
    assert.equal(
      once,
      "## Old\n\nsuperseded-by:: [[N#New]]\n\n### Decision\n\nKeep it.\n\n## Other\n\nBody.\n",
    );
    // A second insertion lands after the existing field block, not above it.
    const twice = insertFields(once, "Old", ["superseded-on:: 2026-10-05"]);
    assert.match(
      twice!,
      /superseded-by:: \[\[N#New\]\]\nsuperseded-on:: 2026-10-05\n\n### Decision/,
    );
    assert.equal(insertFields(text, "Missing", ["x:: y"]), null);
  });
});

describe("lifecycle analysis", () => {
  const resolver = (_source: string, target: string) =>
    ["a", "b"].includes(target) ? [`${target}.md`] : [];

  it("finds broken targets, one-sided links, cycles, and expiry", () => {
    const contents = new Map([
      [
        "a.md",
        [
          "## One",
          "supersedes:: [[b#Two]]",
          "## Three",
          "superseded-by:: [[b#Missing]]",
          "## Loop A",
          "superseded-by:: [[a#Loop B]]",
          "## Loop B",
          "superseded-by:: [[a#Loop A]]",
          "## Whole note",
          "supersedes:: [[b]]",
          "## Promo",
          "valid-until:: 2026-01-01",
        ].join("\n"),
      ],
      ["b.md", "## Two\n\n### Decision\n"],
    ]);

    const result = analyzeLifecycle(contents, resolver, [], "2026-10-05");
    const messages = result.issues.map((issue) => `${issue.code} ${issue.level} ${issue.message}`);

    assert.ok(messages.some((m) => m.includes('no heading "Missing"')));
    assert.ok(messages.some((m) => m.includes("must point at a heading")));
    assert.ok(messages.some((m) => /LIFECYCLE error supersession cycle/.test(m)));
    assert.ok(messages.some((m) => /LIFECYCLE warning "One" supersedes "Two"/.test(m)));
    assert.ok(messages.some((m) => /EXPIRED warning "Promo"/.test(m)));
    assert.equal(messages.filter((m) => m.includes("cycle")).length, 1);

    assert.deepEqual(result.missingBackLinks.find((fix) => fix.heading === "Two")?.fields, [
      "superseded-by:: [[a#One]]",
      "superseded-on:: 2026-10-05",
    ]);
  });

  it("flags a capsule that links a superseded heading", () => {
    const contents = new Map([
      ["cap.md", "See [[b#Two]] and [[b#Three]]."],
      ["b.md", "## Two\nsuperseded-by:: [[#Three]]\n## Three\nsupersedes:: [[#Two]]\n"],
    ]);
    const result = analyzeLifecycle(
      contents,
      (_s, t) => (t === "b" ? ["b.md"] : []),
      ["cap.md"],
      "2026-10-05",
    );
    const stale = result.issues.filter((issue) => issue.code === "STALE-REF");
    assert.equal(stale.length, 1);
    assert.match(stale[0].message, /\[\[b#Two\]\], which is superseded/);
    assert.deepEqual(result.counts, { live: 1, superseded: 1, expired: 0 });
  });
});

describe("lifecycle in a vault", () => {
  it("doctor reports one-sided links and --repair completes them", async () => {
    const root = await scaffold();
    await append(
      root,
      DECISIONS,
      "\n## Flat Pricing\n\n### Decision\n\nOne price.\n\n## Usage Pricing\n\nsupersedes:: [[Meridian Decisions#Flat Pricing]]\n\n### Decision\n\nPer seat.\n",
    );
    const vaultManifest = INPUT;

    const before = await runDoctor(root, vaultManifest, { today: "2026-10-05" });
    assert.ok(before.ok, "a one-sided link is a warning, not an error");
    assert.ok(before.findings.some((f) => f.code === "LIFECYCLE" && f.level === "warning"));

    const operatorText = await read(root, DECISIONS);
    const touched = await repairLifecycle(root, vaultManifest, "2026-10-05");
    assert.deepEqual(touched, [DECISIONS]);

    const repaired = await read(root, DECISIONS);
    assert.match(
      repaired,
      /## Flat Pricing\n\nsuperseded-by:: \[\[Meridian Decisions#Usage Pricing\]\]\nsuperseded-on:: 2026-10-05\n\n### Decision\n\nOne price\./,
    );
    // Repair only inserts: every original line is still there, in order.
    const inserted = repaired
      .split("\n")
      .filter((line) => !line.startsWith("superseded-"))
      .join("\n");
    assert.equal(inserted.replace(/\n{3,}/g, "\n\n"), operatorText.replace(/\n{3,}/g, "\n\n"));

    const after = await runDoctor(root, vaultManifest, { today: "2026-10-05" });
    assert.ok(!after.findings.some((f) => f.code === "LIFECYCLE"), JSON.stringify(after.findings));
    assert.deepEqual(after.lifecycle, { live: 1, superseded: 1, expired: 0 });

    // Idempotent: nothing left to do.
    assert.deepEqual(await repairLifecycle(root, vaultManifest, "2026-10-05"), []);
  });

  it("doctor fails on a broken lifecycle target", async () => {
    const root = await scaffold();
    await append(root, DECISIONS, "\n## New\n\nsupersedes:: [[Meridian Decisions#Nope]]\n");
    const report = await runDoctor(root, INPUT);
    assert.ok(!report.ok);
    assert.ok(report.findings.some((f) => f.code === "LIFECYCLE" && f.level === "error"));
  });

  it("append_decision with supersedes marks both sides in one call", async () => {
    const root = await scaffold();
    const handle = await openVault(root);

    await appendDecision(handle, "meridian", "Flat Pricing", "One price for every plan.");
    const result = await appendDecision(
      handle,
      "meridian",
      "Usage Pricing",
      "Price per active seat.",
      undefined,
      { supersedes: "flat pricing", on: "2026-10-05", source: "import · codex · 2026-09-14" },
    );
    assert.equal(result?.superseded, "Flat Pricing");

    const text = await read(root, DECISIONS);
    assert.match(
      text,
      /## Flat Pricing\n\nsuperseded-by:: \[\[Meridian Decisions#Usage Pricing\]\]\nsuperseded-on:: 2026-10-05\n\n### Decision/,
    );
    assert.match(
      text,
      /## Usage Pricing\n\nsupersedes:: \[\[Meridian Decisions#Flat Pricing\]\]\nsource:: import · codex · 2026-09-14\n\n### Decision\n\nPrice per active seat\./,
    );

    const report = await runDoctor(root, INPUT, { today: "2026-10-05" });
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings));
    assert.equal(report.counts.warning, 0, JSON.stringify(report.findings));
  });

  it("append_decision refuses a bad supersede target and writes nothing", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await appendDecision(handle, "meridian", "Old", "a");
    await appendDecision(handle, "meridian", "New", "b", undefined, { supersedes: "Old" });
    const before = await read(root, DECISIONS);

    await assert.rejects(
      appendDecision(handle, "meridian", "Newer", "c", undefined, { supersedes: "Ghost" }),
      LifecycleTargetError,
    );
    await assert.rejects(
      appendDecision(handle, "meridian", "Newer", "c", undefined, { supersedes: "Old" }),
      /already superseded/,
    );
    await assert.rejects(
      appendDecision(handle, "meridian", "New", "c", undefined, { supersedes: "New" }),
      /distinct title/,
    );
    assert.equal(await read(root, DECISIONS), before);
  });

  it("append_rule supersedes a rule the same way", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await appendRule(handle, "meridian", "Naming", "Use kebab-case.");
    const result = await appendRule(handle, "meridian", "Naming v2", "Use snake_case.", {
      supersedes: "Naming Rule",
    });
    assert.equal(result?.superseded, "Naming Rule");
    const report = await runDoctor(root, INPUT);
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings));
    assert.equal(report.lifecycle.superseded, 1);
  });

  it("recall lists dead memory and search ranks it last", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await appendDecision(handle, "meridian", "Weekly Releases", "Ship every Friday.");
    await appendDecision(handle, "meridian", "Daily Releases", "Ship every day.", undefined, {
      supersedes: "Weekly Releases",
    });
    await append(root, DECISIONS, "\n## Launch Promo\n\nvalid-until:: 2020-01-01\n\nShip free.\n");

    const result = await recall(handle, "meridian");
    assert.deepEqual(
      result?.lifecycle?.superseded.map((entry) => entry.heading),
      ["Weekly Releases"],
    );
    assert.deepEqual(
      result?.lifecycle?.expired.map((entry) => [entry.heading, entry.validUntil]),
      [["Launch Promo", "2020-01-01"]],
    );

    const hits = await search(handle, "ship");
    assert.equal(hits.at(-1)?.state !== undefined, true);
    const firstDead = hits.findIndex((hit) => hit.state);
    assert.ok(firstDead > 0);
    assert.ok(hits.slice(firstDead).every((hit) => hit.state));
    assert.ok(hits.some((hit) => hit.state === "superseded"));
    assert.ok(hits.some((hit) => hit.state === "expired"));

    // A capsule pointing at the dead decision is reported.
    await append(root, CAPSULE, "\nSee [[Meridian Decisions#Weekly Releases]].\n");
    const report = await runDoctor(root, INPUT);
    assert.ok(report.findings.some((f) => f.code === "STALE-REF" && f.file === CAPSULE));
  });
});
