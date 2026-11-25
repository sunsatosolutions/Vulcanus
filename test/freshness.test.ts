import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { reviewCommand } from "../src/commands/review.js";
import { collectStats } from "../src/commands/stats.js";
import { EXIT } from "../src/errors.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { normalizeManifest, readManifest, writeManifest } from "../src/manifest/io.js";
import { migrateManifest } from "../src/manifest/migrate.js";
import { MANIFEST_VERSION, validateManifest } from "../src/manifest/schema.js";
import { assessNote, oldestFirst, stampReviewed } from "../src/memory/freshness.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const ON = "2026-06-01";
const CONTEXT = {
  today: ON,
  staleAfterDays: { decisions: 100 },
  exists: (path: string) => path === "docs/guide.md",
  checkRefs: true,
};

function note(fields: string[], body = "# Note\n\nText.\n", type = "decisions"): string {
  return ["---", `type: ${type}`, "project: Alpha", "status: active", ...fields, "---", body].join(
    "\n",
  );
}

describe("note freshness state", () => {
  it("is fresh inside the limit and stale one day past it", () => {
    // 2026-06-01 minus 100 days is 2026-02-21.
    assert.equal(assessNote("a.md", note(["reviewed: 2026-02-21"]), CONTEXT).state, "fresh");
    const stale = assessNote("a.md", note(["reviewed: 2026-02-20"]), CONTEXT);
    assert.equal(stale.state, "stale");
    assert.equal(stale.ageDays, 101);
    assert.equal(stale.staleAfter, 100);
  });

  it("is unknown without a reviewed date or without any limit, and never throws", () => {
    assert.equal(assessNote("a.md", note([]), CONTEXT).state, "unknown");
    assert.equal(
      assessNote("a.md", note(["reviewed: 2026-05-01"], undefined, "capsule"), CONTEXT).state,
      "unknown",
    );
    assert.equal(assessNote("a.md", "no frontmatter at all", CONTEXT).state, "unknown");
    assert.equal(assessNote("a.md", "", CONTEXT).state, "unknown");
  });

  it("lets stale_after override the type default, and matches types without case", () => {
    const text = note(["reviewed: 2026-05-20", "stale_after: 5"]);
    assert.equal(assessNote("a.md", text, CONTEXT).state, "stale");
    const capsule = note(["reviewed: 2026-01-01", "stale_after: 365"], undefined, "Capsule");
    assert.equal(assessNote("a.md", capsule, CONTEXT).state, "fresh");
    const upper = note(["reviewed: 2026-01-01"], undefined, "Decisions");
    assert.equal(assessNote("a.md", upper, CONTEXT).state, "stale");
  });

  it("reports a broken date as a problem and does not guess", () => {
    for (const bad of ["reviewed: yesterday", "reviewed: 2026-02-30", "reviewed: 2026-13-01"]) {
      const result = assessNote("a.md", note([bad]), CONTEXT);
      assert.equal(result.state, "unknown", bad);
      assert.equal(result.problems.length, 1, bad);
    }
    const future = assessNote("a.md", note(["reviewed: 2026-07-01"]), CONTEXT);
    assert.equal(future.state, "unknown");
    assert.match(future.problems[0], /future/);
  });

  it("ignores a bad stale_after, falls back to the default, and says so", () => {
    for (const bad of ["soon", "0", "-3", "1.5"]) {
      const result = assessNote(
        "a.md",
        note(["reviewed: 2026-05-30", `stale_after: ${bad}`]),
        CONTEXT,
      );
      assert.equal(result.state, "fresh", bad);
      assert.equal(result.staleAfter, 100, bad);
      assert.equal(result.problems.length, 1, bad);
    }
  });

  it("flags a missing path written as code as dead-ref", () => {
    const body = "# N\n\nSee `docs/guide.md` and `docs/gone.md`.\n";
    const result = assessNote("a.md", note(["reviewed: 2026-05-30"], body), CONTEXT);
    assert.equal(result.state, "dead-ref");
    assert.deepEqual(result.deadRefs, ["docs/gone.md"]);

    // Without a reviewed date the dead path is still reported.
    assert.equal(assessNote("a.md", note([], body), CONTEXT).state, "dead-ref");
    // Past its limit a note is stale first, and keeps its dead paths.
    const both = assessNote("a.md", note(["reviewed: 2026-01-01"], body), CONTEXT);
    assert.equal(both.state, "stale");
    assert.deepEqual(both.deadRefs, ["docs/gone.md"]);
  });

  it("skips URLs, absolute paths, escaping paths, globs, prose, and paths outside code", () => {
    const body = [
      "# N",
      "",
      "Links: `https://example.com/a/b.ts`, `/etc/hosts.conf`, `~/x/y.md`, `../outside/z.md`,",
      "`docs/../../escape.md`, `src/*.ts`, `and/or`, `example.com/docs/api`, [[Other]].",
      "Plain prose mentions docs/missing.md without code formatting.",
      "<!-- `docs/in-comment.md` -->",
      "",
    ].join("\n");
    const result = assessNote("a.md", note(["reviewed: 2026-05-30"], body), CONTEXT);
    assert.deepEqual(result.deadRefs, []);
    assert.equal(result.state, "fresh");
  });

  it("does not read paths from the frontmatter", () => {
    const result = assessNote(
      "a.md",
      note(["reviewed: 2026-05-30", "note: `docs/gone.md`"]),
      CONTEXT,
    );
    assert.deepEqual(result.deadRefs, []);
  });

  it("orders stale notes longest-unreviewed first, ties by path", () => {
    const make = (path: string, reviewed: string) =>
      assessNote(path, note([`reviewed: ${reviewed}`]), CONTEXT);
    const list = oldestFirst([
      make("b.md", "2026-01-10"),
      make("a.md", "2026-01-10"),
      make("c.md", "2025-11-01"),
      make("fresh.md", "2026-05-30"),
    ]);
    assert.deepEqual(
      list.map((entry) => entry.path),
      ["c.md", "a.md", "b.md"],
    );
  });
});

describe("stamping reviewed", () => {
  const before = note(
    ["tags:", "  - alpha", "owner: Ada"],
    "# Title\n\nBody with `docs/guide.md`.\n\n",
  );

  it("adds the line before the closing delimiter and touches nothing else", () => {
    const after = stampReviewed(before, ON)!;
    const was = before.split("\n");
    const now = after.split("\n");
    assert.equal(now.length, was.length + 1);
    assert.equal(now[now.indexOf(`reviewed: ${ON}`) + 1], "---");
    assert.deepEqual(
      now.filter((line) => line !== `reviewed: ${ON}`),
      was,
    );
  });

  it("replaces an existing line in place and keeps CRLF endings", () => {
    const crlf = before
      .replace(/\n/g, "\r\n")
      .replace("owner: Ada", "reviewed: 2020-01-01\r\nowner: Ada");
    const after = stampReviewed(crlf, ON)!;
    assert.equal(after, crlf.replace("reviewed: 2020-01-01", `reviewed: ${ON}`));
    assert.equal(stampReviewed(after, ON), after);
  });

  it("refuses a note with no frontmatter or an unclosed one", () => {
    assert.equal(stampReviewed("# Title\n", ON), null);
    assert.equal(stampReviewed("---\ntype: x\n# Title\n", ON), null);
  });
});

describe("freshness in the manifest", () => {
  it("migrates a version 1 manifest with freshness left off", () => {
    const input = manifest({ manifestVersion: 1 });
    const result = migrateManifest(input);
    assert.equal(result.manifest.manifestVersion, MANIFEST_VERSION);
    assert.equal(result.manifest.freshness, undefined);
    assert.deepEqual(validateManifest(result.manifest), [
      {
        level: "warning",
        message: "no projects defined; the vault will only contain its system layer",
      },
    ]);
  });

  it("does not warn about a version 1 manifest, but does about a newer one", () => {
    assert.deepEqual(
      validateManifest(manifest({ manifestVersion: 1, projects: [project("a", "A")] })),
      [],
    );
    const newer = manifest({
      manifestVersion: MANIFEST_VERSION + 1,
      projects: [project("a", "A")],
    });
    assert.match(validateManifest(newer)[0].message, /does not match this CLI/);
  });

  it("keeps the field through a read and write, and warns about bad values", () => {
    const input = manifest({ freshness: { staleAfterDays: { decisions: 90 } } });
    assert.deepEqual(normalizeManifest(input).freshness, { staleAfterDays: { decisions: 90 } });

    const bad = manifest({ freshness: { staleAfterDays: { decisions: 0, rules: 1.5 } } });
    const messages = validateManifest(bad).map((issue) => issue.message);
    assert.equal(messages.filter((message) => message.includes("freshness")).length, 2);
    assert.ok(validateManifest(bad).every((issue) => issue.level === "warning"));

    const broken = manifest({ freshness: { staleAfterDays: [] as never } });
    assert.ok(validateManifest(broken).some((issue) => issue.message.includes("freshness is off")));
  });
});

const DECISIONS = "02_Projects/Alpha/Alpha Decisions.md";
const RULES = "02_Projects/Alpha/Alpha Rules.md";
const CAPSULE = "02_Projects/Alpha/Alpha Capsule.md";

async function vaultWith(
  input: ReturnType<typeof manifest>,
  notes: Record<string, string>,
  code: Record<string, string> = {},
) {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  for (const [path, text] of Object.entries(notes)) {
    await mkdir(dirname(resolve(vault, path)), { recursive: true });
    await writeFile(resolve(vault, path), text);
  }
  for (const [path, text] of Object.entries(code)) {
    await mkdir(dirname(resolve(parent, "alpha-src", path)), { recursive: true });
    await writeFile(resolve(parent, "alpha-src", path), text);
  }
  return vault;
}

async function capture<T>(
  action: () => Promise<T>,
  stream: "stdout" | "stderr" = "stdout",
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

const ON_INPUT = manifest({
  projects: [project("alpha", "Alpha", { root: "../alpha-src" })],
  freshness: { staleAfterDays: { decisions: 100, rules: 30 } },
});

const NOTES = {
  [DECISIONS]: note(
    ["reviewed: 2026-01-10", "tags:", "  - a"],
    "# Alpha Decisions\n\nSee `src/app.ts`.\n",
  ),
  [RULES]: note(
    ["reviewed: 2026-05-25", "tags:", "  - a"],
    "# Alpha Rules\n\nSee `docs/gone.md` and `src/app.ts`.\n",
    "rules",
  ),
  [CAPSULE]: note(
    ["reviewed: soon", "tags:", "  - a"],
    "# Alpha Capsule\n\nNo paths.\n",
    "capsule",
  ),
};

describe("doctor freshness codes", () => {
  it("reports STALE-NOTE, DEAD-PATH and FRESHNESS as warnings and keeps the verdict", async () => {
    const vault = await vaultWith(ON_INPUT, NOTES, { "src/app.ts": "export {};\n" });
    const report = await runDoctor(vault, await readManifest(vault), { today: ON });
    const pick = (code: string) => report.findings.filter((finding) => finding.code === code);

    assert.equal(pick("STALE-NOTE").length, 1);
    assert.equal(pick("STALE-NOTE")[0].file, DECISIONS);
    assert.match(pick("STALE-NOTE")[0].message, /142 days ago \(limit 100\)/);
    assert.match(pick("STALE-NOTE")[0].message, /review --ok "Alpha Decisions"/);
    assert.deepEqual(
      pick("DEAD-PATH").map((finding) => [finding.file, finding.message]),
      [[RULES, "`docs/gone.md` does not exist"]],
    );
    assert.equal(pick("FRESHNESS")[0].file, CAPSULE);
    for (const code of ["STALE-NOTE", "DEAD-PATH", "FRESHNESS"]) {
      assert.ok(
        pick(code).every((finding) => finding.level === "warning"),
        code,
      );
    }
    // Nothing the new codes add is an error.
    const without = await runDoctor(
      vault,
      { ...(await readManifest(vault)), freshness: undefined },
      { today: ON },
    );
    assert.equal(report.counts.error, without.counts.error);
    assert.equal(report.ok, without.ok);
  });

  it("looks for a path in the project's root too, and finds src/app.ts there", async () => {
    const withCode = await vaultWith(ON_INPUT, NOTES, { "src/app.ts": "export {};\n" });
    const without = await vaultWith(ON_INPUT, NOTES);
    const dead = async (vault: string) =>
      (await runDoctor(vault, await readManifest(vault), { today: ON })).findings
        .filter((finding) => finding.code === "DEAD-PATH")
        .map((finding) => finding.message);
    assert.deepEqual(await dead(withCode), ["`docs/gone.md` does not exist"]);
    assert.deepEqual(await dead(without), [
      "`src/app.ts` does not exist",
      "`docs/gone.md` does not exist",
      "`src/app.ts` does not exist",
    ]);
  });

  it("resolves a hand-written note's paths against its nearest project root", async () => {
    const input = manifest({
      projects: [
        project("alpha", "Alpha", { root: "../alpha-src" }),
        project("beta", "Beta", { root: "../beta-src", parent: "alpha" }),
      ],
      freshness: { staleAfterDays: { decisions: 100 } },
    });
    const body = (name: string) =>
      note(["reviewed: 2026-05-25"], `# ${name}\n\nSee \`package.json\`.\n`);
    const vault = await vaultWith(
      input,
      {
        "02_Projects/Alpha/Extra.md": body("Extra"),
        "02_Projects/Alpha/Beta/Extra.md": body("BetaExtra"),
      },
      { "package.json": "{}\n" },
    );
    const dead = (await runDoctor(vault, await readManifest(vault), { today: ON })).findings
      .filter((finding) => finding.code === "DEAD-PATH" && finding.file?.endsWith("Extra.md"))
      .map((finding) => finding.file);
    // alpha-src has package.json; beta-src, the nearest root for the nested note, does not.
    assert.deepEqual(dead, ["02_Projects/Alpha/Beta/Extra.md"]);
  });

  it("says nothing when the manifest has no freshness field", async () => {
    const input = manifest({ projects: [project("alpha", "Alpha")] });
    const vault = await vaultWith(input, NOTES);
    const report = await runDoctor(vault, await readManifest(vault), { today: ON });
    assert.deepEqual(
      report.findings.filter((finding) =>
        ["STALE-NOTE", "DEAD-PATH", "FRESHNESS"].includes(finding.code),
      ),
      [],
    );
  });
});

describe("review command", () => {
  it("lists stale notes oldest first, as text and as JSON", async () => {
    const vault = await vaultWith(ON_INPUT, {
      ...NOTES,
      [RULES]: note(["reviewed: 2026-03-01", "tags:", "  - a"], "# R\n", "rules"),
    });

    const json = await capture(() => reviewCommand({ cwd: vault, json: true, today: ON }));
    assert.equal(json.result, EXIT.ok);
    const parsed = JSON.parse(json.output) as { enabled: boolean; stale: { path: string }[] };
    assert.equal(parsed.enabled, true);
    assert.deepEqual(
      parsed.stale.map((entry) => entry.path),
      [DECISIONS, RULES],
    );

    const text = await capture(() => reviewCommand({ cwd: vault, today: ON }));
    assert.equal(text.result, EXIT.ok);
    assert.ok(text.output.indexOf("Alpha Decisions.md") < text.output.indexOf("Alpha Rules.md"));
  });

  it("is quiet and successful when freshness is off", async () => {
    const vault = await vaultWith(manifest({ projects: [project("alpha", "Alpha")] }), NOTES);
    const { result, output } = await capture(() =>
      reviewCommand({ cwd: vault, json: true, today: ON }),
    );
    assert.equal(result, EXIT.ok);
    assert.deepEqual(JSON.parse(output), { enabled: false, today: ON, stale: [] });
  });

  it("--ok rewrites only the reviewed line of the one note", async () => {
    const vault = await vaultWith(ON_INPUT, NOTES);
    const files = [DECISIONS, RULES, CAPSULE];
    const snapshot = async () =>
      Promise.all(files.map((file) => readFile(resolve(vault, file), "utf8")));
    const before = await snapshot();

    const { result } = await capture(() =>
      reviewCommand({ cwd: vault, ok: "alpha decisions", today: ON, json: true }),
    );
    assert.equal(result, EXIT.ok);

    const after = await snapshot();
    assert.deepEqual(after.slice(1), before.slice(1));
    assert.equal(after[0], before[0].replace("reviewed: 2026-01-10", `reviewed: ${ON}`));
    assert.notEqual(after[0], before[0]);

    const next = await capture(() => reviewCommand({ cwd: vault, json: true, today: ON }));
    assert.deepEqual((JSON.parse(next.output) as { stale: unknown[] }).stale, []);
  });

  it("--ok adds the line when the note had none, and accepts a path", async () => {
    const vault = await vaultWith(ON_INPUT, {
      [DECISIONS]: note(["tags:", "  - a"], "# D\n"),
    });
    const before = await readFile(resolve(vault, DECISIONS), "utf8");
    await capture(() => reviewCommand({ cwd: vault, ok: DECISIONS, today: ON }));
    const after = await readFile(resolve(vault, DECISIONS), "utf8");
    assert.equal(after, before.replace("\n---\n# D", `\nreviewed: ${ON}\n---\n# D`));
  });

  it("--ok fails with a problem for an unknown, ambiguous, or frontmatter-less note", async () => {
    const vault = await vaultWith(ON_INPUT, {
      [DECISIONS]: "# no frontmatter\n",
      "02_Projects/Alpha/Extra/Alpha Rules.md": note([], "# dup\n"),
    });
    const attempt = (ok: string) =>
      capture(() => reviewCommand({ cwd: vault, ok, today: ON }), "stderr");

    const unknown = await attempt("Nope");
    assert.equal(unknown.result, EXIT.usage);
    assert.match(unknown.output, /No note named "Nope"/);

    const ambiguous = await attempt("Alpha Rules");
    assert.equal(ambiguous.result, EXIT.usage);
    assert.match(ambiguous.output, /matches 2 notes/);

    const bare = await attempt("Alpha Decisions");
    assert.equal(bare.result, EXIT.usage);
    assert.match(bare.output, /no frontmatter/);
    assert.equal(await readFile(resolve(vault, DECISIONS), "utf8"), "# no frontmatter\n");
  });
});

describe("stats stale count", () => {
  it("counts stale notes, and is null when freshness is off", async () => {
    const vault = await vaultWith(ON_INPUT, NOTES);
    assert.equal((await collectStats(vault, ON)).staleNotes, 1);

    const off = await vaultWith(manifest({ projects: [project("alpha", "Alpha")] }), NOTES);
    assert.equal((await collectStats(off, ON)).staleNotes, null);
  });
});
