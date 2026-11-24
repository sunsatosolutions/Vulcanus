import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { driftCommand, type DriftReport } from "../src/commands/drift.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { normalizeManifest, writeManifest } from "../src/manifest/io.js";
import { validateManifest } from "../src/manifest/schema.js";
import { extractClaims, findDrift } from "../src/memory/drift.js";
import { parseSections } from "../src/memory/lifecycle.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const ON = "2026-06-01";
const CAPSULE = "02_Projects/Alpha/Alpha Capsule.md";
const RULES = "02_Projects/Alpha/Alpha Rules.md";
const DECISIONS = "02_Projects/Alpha/Alpha Decisions.md";

const STALE_NOTES: Record<string, string> = {
  [CAPSULE]: [
    "---",
    "type: capsule",
    "---",
    "# Alpha Capsule",
    "",
    "## Layout",
    "",
    "Entry is `src/index.ts`; settings live in `config/app.json`.",
    "Not claims: `https://example.com/a/b.ts`, `/abs/path.ts`, `~/notes/x.md`, `src/*.ts`,",
    "`and/or`, `example.com/docs/api`, `@scope/pkg`, [[Alpha Hub]].",
    "Build with `npm run build`; ship with `npm run ship`.",
    "",
  ].join("\n"),
  [RULES]: ["# Alpha Rules", "", "## Checks", "", "Run `npm run typecheck` first.", ""].join("\n"),
  [DECISIONS]: [
    "# Alpha Decisions",
    "",
    "## Old layout",
    "",
    "superseded-by:: [[Alpha Decisions#New layout]]",
    "superseded-on:: 2026-01-01",
    "",
    "Code lived in `legacy/main.ts`.",
    "",
    "## Old deploy",
    "",
    "valid-until:: 2026-02-01",
    "",
    "Use `npm run gone`.",
    "",
    "## New layout",
    "",
    "supersedes:: [[Alpha Decisions#Old layout]]",
    "",
    "```bash",
    "npm test",
    "cat src/index.ts docs/missing.md",
    "```",
    "",
  ].join("\n"),
};

const FRESH_NOTES: Record<string, string> = {
  [CAPSULE]:
    "# Alpha Capsule\n\n## Layout\n\nEntry is `src/index.ts`; build with `npm run build`.\n",
  [RULES]: "# Alpha Rules\n\n## Checks\n\nRun `npm run lint`, then `npm test`.\n",
  [DECISIONS]: "# Alpha Decisions\n\n## Layout\n\nDocs are in `docs/` and `./src/`.\n",
};

async function scaffold(
  notes: Record<string, string>,
  extra: { root?: string } = { root: "../alpha-src" },
) {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const input = manifest({ projects: [project("alpha", "Alpha", extra)] });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  for (const [path, text] of Object.entries(notes)) await writeFile(resolve(vault, path), text);

  const code = resolve(parent, "alpha-src");
  const files: Record<string, string> = {
    "src/index.ts": "export {};\n",
    "docs/README.md": "# docs\n",
    "package.json": JSON.stringify({ scripts: { build: "tsc", lint: "eslint .", test: "node" } }),
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(resolve(code, path)), { recursive: true });
    await writeFile(resolve(code, path), text);
  }
  return { parent, vault, code };
}

async function capture<T>(
  stream: "stdout" | "stderr",
  action: () => Promise<T>,
): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process[stream].write.bind(process[stream]);
  process[stream].write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    return { result: await action(), output: chunks.join("") };
  } finally {
    process[stream].write = original;
  }
}

describe("drift claim parser", () => {
  it("reads relative paths and npm commands, and nothing else", () => {
    const text = STALE_NOTES[CAPSULE];
    const claims = extractClaims(text, parseSections(CAPSULE, text), ON);
    assert.deepEqual(
      claims.map((claim) => [claim.line, claim.kind, claim.text]),
      [
        [8, "path", "src/index.ts"],
        [8, "path", "config/app.json"],
        [11, "script", "npm run build"],
        [11, "script", "npm run ship"],
      ],
    );
  });

  it("reads fenced blocks, `npm test`, and `npm start`, and skips frontmatter", () => {
    const text =
      "---\nsource: `fm/skipped.md`\n---\n```sh\nnpm test\nnpm start\ncat ./src/a.ts:12\n```\n";
    const claims = extractClaims(text, [], ON);
    assert.deepEqual(
      claims.map((claim) => [claim.line, claim.text]),
      [
        [5, "npm test"],
        [6, "npm start"],
        [7, "./src/a.ts"],
      ],
    );
  });

  it("skips superseded and expired sections", () => {
    const text = STALE_NOTES[DECISIONS];
    const claims = extractClaims(text, parseSections(DECISIONS, text), ON);
    assert.deepEqual(
      claims.map((claim) => claim.text),
      ["npm test", "src/index.ts", "docs/missing.md"],
    );
    // The same expired section counts again before its date passes.
    const early = extractClaims(text, parseSections(DECISIONS, text), "2026-01-15");
    assert.ok(early.some((claim) => claim.text === "npm run gone"));
  });

  it("does not read a path out of a comment", () => {
    assert.deepEqual(extractClaims("<!--\n`src/hidden.ts`\n-->\n", [], ON), []);
  });

  it("skips single-line and inline comments and keeps line numbers", () => {
    assert.deepEqual(extractClaims("<!-- `src/retired.ts` -->\n", [], ON), []);
    const claims = extractClaims(
      "a <!-- `src/a.ts` --> `src/b.ts` <!-- `src/c.ts`\n`src/d.ts`\n--> `src/e.ts`\n",
      [],
      ON,
    );
    assert.deepEqual(
      claims.map((claim) => [claim.line, claim.text]),
      [
        [1, "src/b.ts"],
        [3, "src/e.ts"],
      ],
    );
  });

  it("does not treat a comment opener inside an inline code span as a comment", () => {
    const claims = extractClaims("write `<!--` then `src/missing.ts`\n`src/next.ts`\n", [], ON);
    assert.deepEqual(
      claims.map((claim) => [claim.line, claim.text]),
      [
        [1, "src/missing.ts"],
        [2, "src/next.ts"],
      ],
    );
  });
});

describe("comment handling is shared by claims and sections", () => {
  const FIELD = "valid-until:: 2020-01-01";
  // `live`: the field is real, so lifecycle expires the section and its claims drop.
  const cases: Array<{ name: string; body: string[]; live: boolean }> = [
    { name: "single line", body: [`<!-- ${FIELD} -->`], live: false },
    { name: "inline", body: [`a <!-- ${FIELD} --> b`], live: false },
    { name: "multi-line", body: ["<!--", FIELD, "-->"], live: false },
    { name: "after prose", body: ["prose <!-- note", FIELD, "--> tail"], live: false },
    { name: "inside inline code", body: ["write `<!--` here", FIELD], live: true },
    { name: "inside double-backtick span holding a backtick", body: ["write ``a`b <!-- c`` here", FIELD], live: true },
    { name: "inside a fence", body: ["```", "<!--", "```", FIELD], live: true },
  ];

  for (const { name, body, live } of cases) {
    it(name, () => {
      const lines = ["## Sec", ...body, "`src/missing.ts`"];
      const text = lines.join("\n");
      const sections = parseSections(DECISIONS, text);
      assert.equal(sections.length, 1);
      assert.equal(sections[0].validUntil, live ? "2020-01-01" : undefined);
      const claims = extractClaims(text, sections, ON);
      assert.deepEqual(
        claims.map((claim) => [claim.line, claim.text]),
        live ? [] : [[lines.length, "src/missing.ts"]],
      );
    });
  }

  it("keeps the review scenario's visible claim with its line number", () => {
    const text = [
      "## Sec",
      "prose <!--",
      "valid-until:: 2020-01-01",
      "-->",
      "`src/missing.ts`",
    ].join("\n");
    const claims = extractClaims(text, parseSections(DECISIONS, text), ON);
    assert.deepEqual(
      claims.map((claim) => [claim.line, claim.text]),
      [[5, "src/missing.ts"]],
    );
  });
});

describe("drift comparison", () => {
  it("flags missing paths and scripts and leaves the rest", async () => {
    const { code } = await scaffold(FRESH_NOTES);
    const claims = extractClaims(
      "`src/index.ts` `docs/` `src/gone.ts` `npm run build` `npm run nope`",
      [],
      ON,
    );
    const drift = findDrift(claims, code);
    assert.deepEqual(
      drift.map((entry) => entry.text),
      ["src/gone.ts", "npm run nope"],
    );
    assert.match(drift[1].reason, /no "nope" script/);
  });

  it("says so when there is no package.json", async () => {
    const { parent } = await scaffold(FRESH_NOTES);
    const drift = findDrift(extractClaims("`npm run build`", [], ON), parent);
    assert.match(drift[0].reason, /no package\.json/);
  });
});

describe("vulcanus drift", () => {
  it("lists stale claims with note path and line, and exits 1", async () => {
    const { vault } = await scaffold(STALE_NOTES);
    const { result, output } = await capture("stdout", () =>
      driftCommand("Alpha", { cwd: vault, today: ON }),
    );
    assert.equal(result, EXIT.failed);
    assert.match(output, new RegExp(`${CAPSULE}:8  \`config/app.json\``));
    assert.match(output, new RegExp(`${CAPSULE}:11  \`npm run ship\``));
    assert.match(output, new RegExp(`${RULES}:5  \`npm run typecheck\``));
    assert.match(output, new RegExp(`${DECISIONS}:\\d+  \`docs/missing.md\``));
    assert.match(output, /supersede "## New layout"/);
    assert.match(output, /superseded-by:: \[\[Alpha Decisions#<replacement heading>\]\]/);
    // Retired sections are history, not drift.
    assert.doesNotMatch(output, /legacy\/main\.ts|npm run gone/);
  });

  it("prints the same findings as JSON", async () => {
    const { vault } = await scaffold(STALE_NOTES);
    const { result, output } = await capture("stdout", () =>
      driftCommand(undefined, { cwd: vault, json: true, today: ON }),
    );
    assert.equal(result, EXIT.failed);
    const report = JSON.parse(output) as DriftReport;
    assert.equal(report.ok, false);
    assert.equal(report.projects.length, 1);
    const found = report.projects[0].findings.map((f) => [f.note, f.line, f.claim]);
    assert.deepEqual(found, [
      [CAPSULE, 8, "config/app.json"],
      [CAPSULE, 11, "npm run ship"],
      [RULES, 5, "npm run typecheck"],
      [DECISIONS, 22, "docs/missing.md"],
    ]);
    assert.equal(report.projects[0].findings[0].suggestion.heading, "Layout");
  });

  it("returns 0 when every claim is backed", async () => {
    const { vault } = await scaffold(FRESH_NOTES);
    const { result, output } = await capture("stdout", () =>
      driftCommand("Alpha", { cwd: vault, today: ON, json: true }),
    );
    assert.equal(result, EXIT.ok);
    const report = JSON.parse(output) as DriftReport;
    assert.equal(report.ok, true);
    assert.ok(report.projects[0].claimsChecked >= 5);
  });

  it("writes nothing", async () => {
    const { vault } = await scaffold(STALE_NOTES);
    const before = await Promise.all(
      Object.keys(STALE_NOTES).map((p) => readFile(resolve(vault, p), "utf8")),
    );
    await capture("stdout", () => driftCommand("Alpha", { cwd: vault, today: ON }));
    const after = await Promise.all(
      Object.keys(STALE_NOTES).map((p) => readFile(resolve(vault, p), "utf8")),
    );
    assert.deepEqual(after, before);
  });

  it("exits 2 with a worked example when the project has no root", async () => {
    const { vault } = await scaffold(FRESH_NOTES, {});
    const { result, output } = await capture("stderr", () => driftCommand("Alpha", { cwd: vault }));
    assert.equal(result, EXIT.usage);
    assert.match(output, /has no source root/);
    assert.match(output, /"root": "\.\.\/alpha"/);
    assert.match(output, /vulcanus drift "Alpha" --root \.\.\/alpha/);
  });

  it("takes --root over the manifest, relative to the working directory", async () => {
    const { vault, parent } = await scaffold(STALE_NOTES, {});
    const { result } = await capture("stdout", () =>
      driftCommand("Alpha", { cwd: vault, root: "../alpha-src", today: ON, json: true }),
    );
    assert.equal(result, EXIT.failed);
    assert.ok(parent);
  });

  it("exits 2 for a root that is not a folder, an unknown project, and a bare --root", async () => {
    const { vault } = await scaffold(FRESH_NOTES);
    const bad = await capture("stderr", () =>
      driftCommand("Alpha", { cwd: vault, root: "../nope" }),
    );
    assert.equal(bad.result, EXIT.usage);
    assert.match(bad.output, /is not a folder/);

    const unknown = await capture("stderr", () => driftCommand("Zed", { cwd: vault }));
    assert.equal(unknown.result, EXIT.usage);
    assert.match(unknown.output, /No project named "Zed"/);

    const bare = await capture("stderr", () =>
      driftCommand(undefined, { cwd: vault, root: "../x" }),
    );
    assert.equal(bare.result, EXIT.usage);
  });

  it("exits 2 outside a vault", async () => {
    const empty = await tempDir();
    tempDirs.push(empty);
    const { result } = await capture("stderr", () => driftCommand(undefined, { cwd: empty }));
    assert.equal(result, EXIT.usage);
  });
});

describe("project root in the manifest", () => {
  const base = manifest({ projects: [project("alpha", "Alpha")] });

  it("survives normalization, trimmed, and a blank one means unset", () => {
    const withRoot = normalizeManifest({
      ...base,
      projects: [project("alpha", "Alpha", { root: "  ../alpha-src " })],
    });
    assert.equal(withRoot.projects[0].root, "../alpha-src");

    const blank = normalizeManifest({
      ...base,
      projects: [project("alpha", "Alpha", { root: "   " })],
    });
    assert.ok(!("root" in blank.projects[0]));
    assert.ok(!("root" in normalizeManifest(base).projects[0]));
  });

  it("rejects a root that is not text", () => {
    const bad = {
      ...base,
      projects: [project("alpha", "Alpha", { root: 3 as unknown as string })],
    };
    assert.ok(validateManifest(bad).some((issue) => /root that is not text/.test(issue.message)));
  });
});
