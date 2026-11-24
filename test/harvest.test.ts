import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { harvestCommand } from "../src/commands/harvest.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { messages } from "../src/i18n.js";
import { writeManifest } from "../src/manifest/io.js";
import { openVault, recall, search } from "../src/mcp/tools.js";
import { harvestCandidates, projectForPaths } from "../src/memory/harvest.js";
import { reviewCandidates } from "../src/memory/inbox.js";
import { parseSections, today } from "../src/memory/lifecycle.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const t = messages("en");

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

/** A throwaway code repository: commit(file, content, message) per step. */
async function codeRepo() {
  const dir = await tempDir();
  tempDirs.push(dir);
  git(dir, "init", "-q");
  let n = 0;
  return {
    dir,
    async commit(file: string, content: string, message: string): Promise<string> {
      await mkdir(join(dir, file, ".."), { recursive: true });
      await writeFile(join(dir, file), content, "utf8");
      git(dir, "add", "-A");
      n += 1;
      git(dir, "commit", "-q", "-m", message, "--allow-empty-message");
      return git(dir, "rev-parse", "HEAD").trim() + (n ? "" : "");
    },
  };
}

async function vault(extra: Parameters<typeof project>[2] = {}) {
  const root = await tempDir();
  tempDirs.push(root);
  const input = manifest({ projects: [project("meridian", "Meridian", extra)] });
  await writeFiles(root, generateFiles(input).files);
  await writeManifest(root, input);
  return { root, input };
}

/** Accepts every candidate as a decision; picks `projectName` when asked which project. */
function accepting(projectName = "Meridian"): { driver: PromptDriver; asked: string[] } {
  const asked: string[] = [];
  const driver: PromptDriver = {
    async text(request) {
      return request.initialValue ?? "";
    },
    async select(request) {
      const values = request.options.map((option) => option.value);
      asked.push(values.join(","));
      return values.includes("decision") ? "decision" : projectName;
    },
    async multiselect() {
      throw new Error("unexpected multiselect");
    },
    async confirm() {
      return false;
    },
  };
  return { driver, asked };
}

async function withDriver<T>(driver: PromptDriver, run: () => Promise<T>): Promise<T> {
  const restore = setPromptDriver(driver);
  try {
    return await run();
  } finally {
    restore();
  }
}

const read = (root: string, path: string) => readFile(resolve(root, path), "utf8");

describe("harvest candidates", () => {
  it("proposes commits that give a reason, in four languages, and nothing else", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Add readme file for the module");
    await repo.commit(
      "meridian/b.txt",
      "1",
      "Log as JSON lines\n\nWe log JSON lines because grep is how we debug.",
    );
    await repo.commit(
      "meridian/c.txt",
      "1",
      "Kuyruk\n\nRedis yerine dosya tabanlı kuyruk kullanıyoruz.",
    );
    await repo.commit("meridian/d.txt", "1", "Tests laufen jetzt mit pytest statt unittest");
    await repo.commit("meridian/e.txt", "1", "Usar yaml en lugar de json para la configuración");
    await repo.commit("meridian/f.txt", "1", 'Revert "Add telemetry hook to the build"');

    const { plan } = await openVault((await vault()).root);
    const { candidates, commits } = await harvestCandidates(plan, repo.dir, "30d");

    assert.equal(commits, 6);
    assert.equal(candidates.length, 5);
    assert.ok(candidates.every((candidate) => candidate.project === "Meridian"));
    assert.ok(candidates.every((candidate) => /^[0-9a-f]{40}$/.test(candidate.commit!.sha)));
    const text = candidates.map((candidate) => candidate.text).join("\n");
    assert.match(text, /because grep is how we debug/);
    assert.match(text, /Redis yerine/);
    assert.match(text, /statt unittest/);
    assert.match(text, /en lugar de json/);
    assert.match(text, /Revert/);
    assert.doesNotMatch(text, /readme/);
  });

  it("keeps at most 15 candidates per project", async () => {
    const repo = await codeRepo();
    for (let n = 0; n < 20; n += 1) {
      await repo.commit(
        `meridian/f${n}.txt`,
        "1",
        `Use ${"abcdefghijklmnopqrst"[n]}${n}module layout instead of the old layout ${"uvwxyz".repeat(2)}${n}`,
      );
    }
    const { plan } = await openVault((await vault()).root);
    const { candidates } = await harvestCandidates(plan, repo.dir, "30d");
    assert.equal(candidates.length, 15);
  });

  it("keeps sha and paths from the same commit when two commits share a message", async () => {
    const repo = await codeRepo();
    const message = "Cache on disk because memory use doubled under load";
    await repo.commit("meridian/old.txt", "1", message);
    const newest = await repo.commit("meridian/new.txt", "1", message);
    const { plan } = await openVault((await vault()).root);
    const { candidates } = await harvestCandidates(plan, repo.dir, "30d");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].commit!.sha, newest);
    assert.deepEqual(candidates[0].commit!.paths, ["meridian/new.txt"]);
  });

  it("assigns by the first directory only when every file agrees", () => {
    const plan = {
      allProjects: [
        { project: project("meridian", "Meridian") },
        { project: project("orbit", "Orbit") },
      ],
    } as unknown as Parameters<typeof projectForPaths>[0];
    assert.equal(projectForPaths(plan, ["meridian/a.ts", "package.json"]), "Meridian");
    assert.equal(projectForPaths(plan, ["Meridian/a.ts", "meridian/b/c.ts"]), "Meridian");
    assert.equal(projectForPaths(plan, ["meridian/a.ts", "orbit/b.ts"]), undefined);
    assert.equal(projectForPaths(plan, ["meridian/a.ts", "docs/b.md"]), undefined);
    assert.equal(projectForPaths(plan, ["package.json"]), undefined);
  });

  it("reads --since as days or as a tag", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because the build breaks on newer majors");
    git(repo.dir, "tag", "v1");
    await repo.commit("meridian/b.txt", "1", "Use pnpm instead of npm for workspaces");
    const { plan } = await openVault((await vault()).root);
    assert.equal((await harvestCandidates(plan, repo.dir, "v1")).candidates.length, 1);
    assert.equal((await harvestCandidates(plan, repo.dir, "30d")).candidates.length, 2);
    await assert.rejects(harvestCandidates(plan, repo.dir, "--output=x"), /neither/);
    await assert.rejects(harvestCandidates(plan, repo.dir, "nope"), /neither/);
  });
});

describe("harvest review and CODE-DRIFT", () => {
  it("writes an accepted candidate with paths, commit and source, never the whole body", async () => {
    const repo = await codeRepo();
    const sha = await repo.commit(
      "meridian/cache.txt",
      "one\n",
      "Cache on disk\n\nWe cache on disk because memory use doubled.\n\nINTERNAL-DETAIL-LINE that must never be copied over.",
    );
    const { root } = await vault();
    const handle = await openVault(root);
    const { candidates } = await harvestCandidates(handle.plan, repo.dir, "30d");
    const { driver } = accepting();
    const outcome = await withDriver(driver, () => reviewCandidates(handle, candidates, "git", t));
    assert.equal(outcome.accepted, 1);

    const note = await read(root, DECISIONS);
    assert.match(note, /^paths:: meridian\/cache\.txt$/m);
    assert.match(note, new RegExp(`^commit:: ${sha}$`, "m"));
    assert.match(note, new RegExp(`^source:: harvest · git · ${today()}$`, "m"));
    assert.doesNotMatch(note, /INTERNAL-DETAIL/);
    const section = parseSections(DECISIONS, note).find((entry) => entry.commit === sha)!;
    assert.deepEqual(section.paths, ["meridian/cache.txt"]);
  });

  it("flags a candidate the vault already records and writes nothing when skipped", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Cache on disk because memory use doubled badly");
    const { root } = await vault();
    const first = await openVault(root);
    const { candidates } = await harvestCandidates(first.plan, repo.dir, "30d");
    await withDriver(accepting().driver, () => reviewCandidates(first, candidates, "git", t));

    const before = await read(root, DECISIONS);
    const second = await openVault(root);
    const again = (await harvestCandidates(second.plan, repo.dir, "30d")).candidates;
    const { compareWithVault } = await import("../src/memory/extract.js");
    const { vaultSections } = await import("../src/memory/inbox.js");
    const marked = compareWithVault(again, await vaultSections(second), { keepKnown: true });
    assert.equal(marked.length, 1);
    assert.ok(marked[0].known);
    assert.equal(compareWithVault(again, await vaultSections(second)).length, 0);

    const skip: PromptDriver = { ...accepting().driver, select: async () => "skip" };
    const outcome = await withDriver(skip, () => reviewCandidates(second, marked, "git", t));
    assert.equal(outcome.skipped, 1);
    assert.equal(await read(root, DECISIONS), before);
  });

  it("asks which project when the files do not say, and never creates one", async () => {
    const repo = await codeRepo();
    await repo.commit("src/a.txt", "1", "Use sqlite instead of a json file for state");
    const { root } = await vault({ root: repo.dir });
    const { driver, asked } = accepting();
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => (out.push(String(chunk)), true);
    setLogLevel("quiet");
    try {
      const code = await withDriver(driver, () =>
        harvestCommand({ cwd: root, since: "30d", json: true }),
      );
      assert.equal(code, 0);
    } finally {
      process.stdout.write = write;
      setLogLevel("normal");
    }
    assert.equal(asked[0], "Meridian,");
    assert.deepEqual(JSON.parse(out.join("")), { candidates: 1, accepted: 1, skipped: 0 });
    assert.match(await read(root, DECISIONS), /^commit:: [0-9a-f]{40}$/m);
    assert.equal((await openVault(root)).plan.allProjects.length, 1);
  });

  it("reports CODE-DRIFT on a content change, not on whitespace, and marks recall and search", async () => {
    const repo = await codeRepo();
    await repo.commit(
      "meridian/cfg.txt",
      "alpha\nbeta\n",
      "Keep config flat because nesting confused users",
    );
    const { root } = await vault({ root: repo.dir });
    const handle = await openVault(root);
    const { candidates } = await harvestCandidates(handle.plan, repo.dir, "30d");
    await withDriver(accepting().driver, () => reviewCandidates(handle, candidates, "git", t));
    const drift = async () =>
      (await runDoctor(root, handle.manifest)).findings.filter((f) => f.code === "CODE-DRIFT");

    assert.deepEqual(await drift(), []);

    await repo.commit("meridian/cfg.txt", "alpha  \n\n beta\n\n", "Reformat the config file");
    assert.deepEqual(await drift(), [], "whitespace and blank lines are not a change");
    const quiet = await recall(await openVault(root), "Meridian");
    assert.equal(quiet?.lifecycle, undefined);

    await repo.commit("meridian/cfg.txt", "alpha\nbeta\ngamma\n", "Add a third key");
    const found = await drift();
    assert.equal(found.length, 1);
    assert.equal(found[0].level, "warning");
    assert.equal(found[0].file, DECISIONS);
    assert.match(found[0].message, /code changed since [0-9a-f]{7} in meridian\/cfg\.txt/);

    const flagged = await recall(await openVault(root), "Meridian");
    assert.equal(flagged?.lifecycle?.codeChanged.length, 1);
    assert.match(flagged.lifecycle.codeChanged[0].note, /verify/);
    const hits = await search(await openVault(root), "Keep config flat");
    assert.ok(hits.length > 0 && hits.every((hit) => hit.codeChanged === true));
  });

  it("warns that it could not verify when the commit or the repository is missing", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const { root, input } = await vault({ root: repo.dir });
    const handle = await openVault(root);
    const { candidates } = await harvestCandidates(handle.plan, repo.dir, "30d");
    await withDriver(accepting().driver, () => reviewCandidates(handle, candidates, "git", t));

    const other = await codeRepo();
    await other.commit("meridian/a.txt", "1", "Unrelated first commit");
    const elsewhere = (await runDoctor(root, input, { codeDir: other.dir })).findings.filter(
      (f) => f.code === "CODE-DRIFT",
    );
    assert.equal(elsewhere.length, 1);
    assert.match(elsewhere[0].message, /could not verify.*was not found/);

    const noRoot = manifest({ projects: [project("meridian", "Meridian")] });
    const missing = (await runDoctor(root, noRoot)).findings.filter((f) => f.code === "CODE-DRIFT");
    assert.match(missing[0].message, /could not verify.*no source root/);
  });
});
