import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { messages } from "../src/i18n.js";
import { writeManifest } from "../src/manifest/io.js";
import { appendDecision, openVault, recall } from "../src/mcp/tools.js";
import { harvestCandidates } from "../src/memory/harvest.js";
import { reviewCandidates } from "../src/memory/inbox.js";
import { parseSections } from "../src/memory/lifecycle.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

const t = messages("en");
const MERIDIAN = "02_Projects/Meridian/Meridian Decisions.md";
const ORION = "02_Projects/Orion/Orion Decisions.md";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
}

async function codeRepo() {
  const dir = await tempDir();
  tempDirs.push(dir);
  git(dir, "init", "-q");
  return {
    dir,
    async commit(file: string, content: string, message: string): Promise<string> {
      await mkdir(join(dir, file, ".."), { recursive: true });
      await writeFile(join(dir, file), content, "utf8");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", message, "--allow-empty-message");
      return git(dir, "rev-parse", "HEAD").trim();
    },
  };
}

async function vault(root: string) {
  const dir = await tempDir();
  tempDirs.push(dir);
  const input = manifest({
    projects: [project("meridian", "Meridian", { root }), project("orion", "Orion", { root })],
  });
  const generated = generateFiles(input).files;
  await writeFiles(dir, generated);
  await writeManifest(dir, input);
  return { dir, input, generated };
}

const read = (root: string, path: string) => readFile(resolve(root, path), "utf8");

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && !entry.parentPath.includes(`${resolve(dir)}/.git`)) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out;
}

describe("Sediment end to end", () => {
  it("harvests, reviews, writes only what is accepted, then flags drift in doctor and recall", async () => {
    const repo = await codeRepo();
    const reasons = {
      a: await repo.commit("meridian/a.txt", "a1\n", "Cache on disk because memory use doubled"),
      b: await repo.commit("orion/b.txt", "b1\n", "Use sqlite instead of a json file for state"),
      c: await repo.commit(
        "meridian/c.txt",
        "c1\n",
        "Keep config flat because nesting confused users",
      ),
      d: await repo.commit(
        "orion/d.txt",
        "d1\n",
        "Pin node 22 because newer majors break the build",
      ),
      e: await repo.commit(
        "meridian/e.txt",
        "e1\n",
        "Drop the retry loop because it hid real errors",
      ),
    };
    await repo.commit("meridian/f.txt", "f1\n", "Fix typo");
    await repo.commit("orion/g.txt", "g1\n", "Bump version");

    const { dir, generated } = await vault(repo.dir);
    const handle = await openVault(dir);
    const { candidates } = await harvestCandidates(handle.plan, repo.dir, "30d");
    assert.equal(candidates.length, 5, "only commits that give a reason, at most 15");
    assert.ok(candidates.length <= 15);

    // Review in a fixed order: accept a, b, c; edit then accept d; skip e.
    const bySha = new Map(candidates.map((c) => [c.commit!.sha, c]));
    const ordered = [reasons.a, reasons.b, reasons.c, reasons.d, reasons.e].map((sha) =>
      bySha.get(sha)!,
    );
    const actions = ["decision", "decision", "decision", "edit", "decision", "skip"];
    const EDITED = "Pin node 22 so the build stays reproducible";
    const driver: PromptDriver = {
      async text(request) {
        return request.message === t.memoryEditText ? EDITED : (request.initialValue ?? "");
      },
      async select() {
        return actions.shift()!;
      },
      async multiselect() {
        throw new Error("unexpected multiselect");
      },
      async confirm() {
        return false;
      },
    };
    const restore = setPromptDriver(driver);
    let outcome;
    try {
      outcome = await reviewCandidates(handle, ordered, "git", t);
    } finally {
      restore();
    }
    assert.equal(outcome.accepted, 4);
    assert.equal(outcome.skipped, 1);

    const meridian = await read(dir, MERIDIAN);
    const orion = await read(dir, ORION);
    const shas = (note: string) =>
      parseSections("", note)
        .map((s) => s.commit)
        .filter(Boolean);
    assert.deepEqual(shas(meridian).sort(), [reasons.a, reasons.c].sort());
    assert.deepEqual(shas(orion).sort(), [reasons.b, reasons.d].sort());
    assert.match(orion, /Pin node 22 so the build stays reproducible/);
    assert.match(meridian, /^paths:: meridian\/a\.txt$/m);
    assert.match(orion, /^paths:: orion\/d\.txt$/m);

    // The skipped candidate reached no file in the vault.
    for (const file of await filesUnder(dir)) {
      const text = await readFile(file, "utf8");
      assert.ok(!text.includes(reasons.e), `${file} holds the skipped commit`);
      assert.ok(!/Drop the retry loop/.test(text), `${file} holds the skipped wording`);
    }

    // Operator notes are never managed: seeded, then repaired, the accepted sections stay.
    for (const path of [MERIDIAN, ORION]) {
      assert.notEqual(generated.find((f) => f.path === path)?.kind, "managed");
    }
    await writeFiles(dir, generated, { repair: true });
    assert.equal(await read(dir, MERIDIAN), meridian);
    assert.equal(await read(dir, ORION), orion);

    // A whole-file rewrite of the code file's content makes the decision doubtful.
    const drift = async () =>
      (await runDoctor(dir, handle.manifest)).findings.filter((f) => f.code === "CODE-DRIFT");
    assert.deepEqual(await drift(), []);
    await repo.commit("meridian/a.txt", "a1\na2 changed\n", "Change the cache");
    const found = await drift();
    assert.equal(found.length, 1);
    assert.equal(found[0].level, "warning");
    assert.equal(found[0].file, MERIDIAN);
    assert.match(found[0].message, /meridian\/a\.txt/);

    const flagged = await recall(await openVault(dir), "Meridian");
    assert.equal(flagged?.lifecycle?.codeChanged.length, 1);
    assert.match(flagged.lifecycle.codeChanged[0].note, /verify/);
    assert.equal((await recall(await openVault(dir), "Orion"))?.lifecycle, undefined);
  });

  it("append_decision writes paths and commit, and rejects bad ones without writing", async () => {
    const repo = await codeRepo();
    const sha = await repo.commit("meridian/x.txt", "x\n", "Seed");
    const { dir } = await vault(repo.dir);
    const handle = await openVault(dir);

    const result = await appendDecision(handle, "Meridian", "Keep x", "x stays flat", undefined, {
      paths: ["meridian/x.txt"],
      commit: sha,
    });
    assert.ok(result);
    const note = await read(dir, MERIDIAN);
    assert.match(note, /^paths:: meridian\/x\.txt$/m);
    assert.match(note, new RegExp(`^commit:: ${sha}$`, "m"));
    const section = parseSections(MERIDIAN, note).find((s) => s.heading === "Keep x")!;
    assert.deepEqual(section.paths, ["meridian/x.txt"]);

    await repo.commit("meridian/x.txt", "x\ny\n", "Edit x");
    const drifted = (await runDoctor(dir, handle.manifest)).findings.filter(
      (f) => f.code === "CODE-DRIFT",
    );
    assert.equal(drifted.length, 1);

    const before = await read(dir, MERIDIAN);
    await assert.rejects(
      appendDecision(handle, "Meridian", "Bad", "d", undefined, { paths: ["a,b"] }),
      /comma, newline or "<!--"/,
    );
    await assert.rejects(
      appendDecision(handle, "Meridian", "Bad3", "d", undefined, {
        paths: ["src/<!--.ts"],
        commit: sha,
      }),
      /comma, newline or "<!--"/,
    );
    await assert.rejects(
      appendDecision(handle, "Meridian", "Bad2", "d", undefined, { commit: "not-a-sha" }),
      /not a commit id/,
    );
    assert.equal(await read(dir, MERIDIAN), before);
  });
});
