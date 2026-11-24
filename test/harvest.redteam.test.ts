/**
 * Red team: attacks on the promises of `vulcanus harvest` (PR #47).
 *
 * Tests that pass pin a promise that holds. Tests marked `todo` are findings:
 * they assert the promise and currently fail, so they stay visible in the run
 * without turning CI red. Remove `todo` when the fix lands.
 * Secrets here are the scanner placeholder shape (prefix + FAKE only).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { harvestCommand } from "../src/commands/harvest.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { messages } from "../src/i18n.js";
import { writeManifest } from "../src/manifest/io.js";
import { openVault } from "../src/mcp/tools.js";
import { capPerProject, harvestCandidates, HarvestError } from "../src/memory/harvest.js";
import { reviewCandidates } from "../src/memory/inbox.js";
import { parseSections } from "../src/memory/lifecycle.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const t = messages("en");
const FAKE_KEY = "AKIAFAKEFAKEFAKEFAKE";

const IDENT = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...IDENT, ...args], { cwd, encoding: "utf8" });

async function codeRepo() {
  const dir = await tempDir();
  tempDirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
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

async function vault(extra: Parameters<typeof project>[2] = {}) {
  const root = await tempDir();
  tempDirs.push(root);
  const input = manifest({ projects: [project("meridian", "Meridian", extra)] });
  await writeFiles(root, generateFiles(input).files);
  await writeManifest(root, input);
  return { root, input };
}

function driverFor(action: "decision" | "skip", asked: string[] = []): PromptDriver {
  return {
    async text(request) {
      return request.initialValue ?? "";
    },
    async select(request) {
      const values = request.options.map((option) => option.value);
      asked.push(values.join(","));
      return values.includes("decision") ? action : "Meridian";
    },
    async multiselect() {
      throw new Error("unexpected multiselect");
    },
    async confirm() {
      return false;
    },
  };
}

async function withDriver<T>(driver: PromptDriver, run: () => Promise<T>): Promise<T> {
  const restore = setPromptDriver(driver);
  try {
    return await run();
  } finally {
    restore();
  }
}

/** Every regular file under `dir` (not following symlinks), path → content. */
function snapshot(dir: string, skipGit = false): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (skipGit && name === ".git") continue;
      const full = join(current, name);
      const info = statSync(full, { throwIfNoEntry: false });
      if (!info) continue;
      if (info.isDirectory()) walk(full);
      else out.set(full, readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** Temp entries that mention `needle`, anywhere under the OS temp dir (top level only walk, bounded). */
function tempFilesWith(needle: string, ignore: string[]): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(tmpdir())) {
    const full = join(tmpdir(), name);
    if (ignore.some((dir) => full === dir || dir.startsWith(`${full}/`))) continue;
    try {
      const info = statSync(full);
      if (info.isFile() && info.size < 1e6 && readFileSync(full, "utf8").includes(needle)) {
        hits.push(full);
      }
    } catch {
      /* unreadable entries are someone else's */
    }
  }
  return hits;
}

async function harvestAll(root: string, repoDir: string, action: "decision" | "skip") {
  const handle = await openVault(root);
  const { candidates } = await harvestCandidates(handle.plan, repoDir, "30d");
  const outcome = await withDriver(driverFor(action), () =>
    reviewCandidates(handle, candidates, "git", t),
  );
  return { candidates, outcome };
}

describe("redteam (a): fake secret in a commit message", () => {
  it("a skipped candidate leaves the vault, the code repo and the temp dir untouched", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", `Use key ${FAKE_KEY} because the bucket needs it`);
    const { root } = await vault({ root: repo.dir });
    const vaultBefore = snapshot(root);
    const codeBefore = snapshot(repo.dir);
    const { candidates, outcome } = await harvestAll(root, repo.dir, "skip");
    assert.equal(candidates.length, 1);
    assert.equal(outcome.skipped, 1);
    assert.deepEqual(snapshot(root), vaultBefore, "vault changed on skip");
    assert.deepEqual(snapshot(repo.dir), codeBefore, "code repo changed on skip");
    assert.deepEqual(tempFilesWith(FAKE_KEY, tempDirs), []);
    const manifestText = await readFile(resolve(root, "vulcanus.json"), "utf8");
    assert.ok(!manifestText.includes(FAKE_KEY));
  });

  it("a stopped review writes nothing either", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", `Token ${FAKE_KEY} stays because ops said so`);
    const { root } = await vault({ root: repo.dir });
    const before = snapshot(root);
    const handle = await openVault(root);
    const { candidates } = await harvestCandidates(handle.plan, repo.dir, "30d");
    const stop: PromptDriver = { ...driverFor("skip"), select: async () => "stop" };
    const outcome = await withDriver(stop, () => reviewCandidates(handle, candidates, "git", t));
    assert.equal(outcome.stopped, true);
    assert.deepEqual(snapshot(root), before);
  });

  it(
    "FINDING: a secret-shaped string is not stopped before review and is written verbatim on accept",
    { todo: "src/memory/harvest.ts:commitStatement has no secret filter; see report" },
    async () => {
      const repo = await codeRepo();
      await repo.commit("meridian/a.txt", "1", `Use key ${FAKE_KEY} because the bucket needs it`);
      const { root } = await vault({ root: repo.dir });
      const { candidates } = await harvestAll(root, repo.dir, "decision");
      const note = await readFile(resolve(root, DECISIONS), "utf8");
      assert.ok(
        !candidates.some((c) => c.text.includes(FAKE_KEY)) && !note.includes(FAKE_KEY),
        "secret-shaped text reached a candidate or the vault",
      );
    },
  );
});

describe("redteam (b): no shell, no network", () => {
  const META = ["; touch PWN", "$(touch PWN)", "`touch PWN`", "30d; touch PWN", "v1 && touch PWN"];

  it("shell metacharacters in --since never run", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const { root } = await vault({ root: repo.dir });
    const { plan } = await openVault(root);
    for (const since of META) {
      await assert.rejects(harvestCandidates(plan, repo.dir, since), HarvestError);
    }
    for (const dir of [repo.dir, root, process.cwd()]) {
      assert.ok(!existsSync(join(dir, "PWN")), `PWN created in ${dir}`);
    }
  });

  it("option-looking --since values are refused", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const { plan } = await openVault((await vault({ root: repo.dir })).root);
    for (const since of ["--output=PWN", "-n1", "--all", "--exec=touch PWN"]) {
      await assert.rejects(harvestCandidates(plan, repo.dir, since), HarvestError);
    }
    assert.ok(!existsSync(join(repo.dir, "PWN")));
  });

  it("file names with shell metacharacters are data, in harvest and in drift checks", async () => {
    const repo = await codeRepo();
    const reasons = [
      "queues use sqlite instead of redis",
      "logs stay json because grep works",
      "retries are capped instead of unbounded",
      "builds pin node because majors break tooling",
    ];
    const names = ["a;touch PWN.txt", "b$(touch PWN).txt", "c`touch PWN`.txt", "d&&touch PWN.txt"];
    for (const [n, name] of names.entries()) {
      await repo.commit(`meridian/${name}`, "1", `Decision ${reasons[n]} here`);
    }
    const { root, input } = await vault({ root: repo.dir });
    const { candidates, outcome } = await harvestAll(root, repo.dir, "decision");
    assert.equal(candidates.length, names.length);
    assert.equal(outcome.accepted, names.length);
    for (const [n, name] of names.entries()) {
      await repo.commit(`meridian/${name}`, "2", `Touch file ${n} again`);
    }
    const drift = (await runDoctor(root, input)).findings.filter((f) => f.code === "CODE-DRIFT");
    assert.equal(drift.length, names.length);
    for (const dir of [repo.dir, root, process.cwd(), join(repo.dir, "meridian")]) {
      assert.ok(!existsSync(join(dir, "PWN")), `PWN created in ${dir}`);
    }
  });

  it("harvest sources import no network or shell module", () => {
    for (const file of [
      "src/memory/harvest.ts",
      "src/commands/harvest.ts",
      "src/util/git.ts",
      "src/memory/codedrift.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.doesNotMatch(source, /node:(https?|net|tls|dns|dgram|http2)\b/, file);
      assert.doesNotMatch(source, /\bfetch\(|\bexecSync\b|\bspawnSync\b|shell:\s*true/, file);
    }
  });

  it(
    "FINDING: a hostile code repository's core.fsmonitor runs during harvest",
    { todo: "src/util/git.ts:git passes no -c core.fsmonitor=false; see report" },
    async () => {
      const repo = await codeRepo();
      await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
      const marker = join(await tempDir(), "RAN");
      tempDirs.push(join(marker, ".."));
      git(repo.dir, "config", "core.fsmonitor", `touch ${marker}; echo`);
      const { plan } = await openVault((await vault({ root: repo.dir })).root);
      await harvestCandidates(plan, repo.dir, "30d");
      assert.ok(!existsSync(marker), "repository config executed a command");
    },
  );

  it(
    "FINDING: drift checks on a partial clone fetch missing blobs from the remote",
    { todo: "src/memory/codedrift.ts:filesChanged; git needs GIT_NO_LAZY_FETCH=1; see report" },
    async () => {
      const origin = await codeRepo();
      git(origin.dir, "config", "uploadpack.allowFilter", "true");
      git(origin.dir, "config", "uploadpack.allowAnySHA1InWant", "true");
      const first = await origin.commit("meridian/cfg.txt", "alpha\n", "Keep it flat because x y");
      await origin.commit("meridian/cfg.txt", "alpha\nbeta\n", "Add beta key");
      const clone = await tempDir();
      tempDirs.push(clone);
      git(clone, "clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, "c");
      const dir = join(clone, "c");
      const have = (sha: string, path: string) => {
        const blob = git(origin.dir, "rev-parse", `${sha}:${path}`).trim();
        try {
          git(dir, "-c", "core.fsmonitor=false", "cat-file", "-e", blob);
          return execFileSync("git", ["cat-file", "-t", blob], {
            cwd: dir,
            encoding: "utf8",
            env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
          }).includes("blob");
        } catch {
          return false;
        }
      };
      void have;
      const { checkCodeDrift } = await import("../src/memory/codedrift.js");
      const section = {
        heading: "S",
        commit: first,
        paths: ["meridian/cfg.txt"],
      } as unknown as Parameters<typeof checkCodeDrift>[1][number];
      const lazy = (env: NodeJS.ProcessEnv) => {
        try {
          execFileSync("git", ["cat-file", "-p", `${first}:meridian/cfg.txt`], {
            cwd: dir,
            env: { ...process.env, ...env },
            stdio: "pipe",
          });
          return true;
        } catch {
          return false;
        }
      };
      assert.equal(lazy({ GIT_NO_LAZY_FETCH: "1" }), false, "blob must start out missing");
      await checkCodeDrift(dir, [section]);
      assert.equal(lazy({ GIT_NO_LAZY_FETCH: "1" }), false, "drift check fetched a blob");
    },
  );
});

describe("redteam (c): writes stay inside the vault", () => {
  it("harvest and accept never modify the code repository, even through a symlinked --code", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const link = join(await tempDir(), "link");
    tempDirs.push(join(link, ".."));
    await symlink(repo.dir, link);
    const { root } = await vault();
    const before = snapshot(repo.dir);
    const out = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    setLogLevel("quiet");
    try {
      const code = await withDriver(driverFor("decision"), () =>
        harvestCommand({ cwd: root, code: link, since: "30d", json: true }),
      );
      assert.ok(code === 0 || code === 1);
    } finally {
      process.stdout.write = out;
      setLogLevel("normal");
    }
    assert.deepEqual(snapshot(repo.dir), before);
    assert.match(await readFile(resolve(root, DECISIONS), "utf8"), /^commit:: [0-9a-f]{40}$/m);
    assert.equal(git(repo.dir, "status", "--porcelain").trim(), "");
  });

  it("a candidate cannot choose the file it is written to", async () => {
    const repo = await codeRepo();
    await repo.commit(
      "meridian/a.txt",
      "1",
      "Use ../../outside.md instead of the old path ../escape/Decisions.md",
    );
    const { root } = await vault({ root: repo.dir });
    const { outcome } = await harvestAll(root, repo.dir, "decision");
    assert.equal(outcome.accepted, 1);
    assert.deepEqual(outcome.written, [DECISIONS]);
    assert.ok(!existsSync(resolve(root, "..", "outside.md")));
  });

  it(
    "FINDING: a Decisions note that is a symlink makes accept write outside the vault",
    { todo: "src/mcp/tools.ts:375 appendSection writes through symlinks; see report" },
    async () => {
      const repo = await codeRepo();
      await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
      const { root } = await vault({ root: repo.dir });
      const outside = join(await tempDir(), "outside.md");
      tempDirs.push(join(outside, ".."));
      await writeFile(outside, "# not the vault\n", "utf8");
      const note = resolve(root, DECISIONS);
      await import("node:fs/promises").then((fs) => fs.rm(note));
      await symlink(outside, note);
      await harvestAll(root, repo.dir, "decision");
      assert.equal(await readFile(outside, "utf8"), "# not the vault\n", "wrote through the link");
    },
  );
});

describe("redteam (d): bounds", () => {
  it("many commits: at most 15 candidates per project, unassigned included", async () => {
    const dir = await tempDir();
    tempDirs.push(dir);
    git(dir, "init", "-q");
    git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
    const lines: string[] = [];
    for (let n = 0; n < 300; n += 1) {
      const msg = `Use module${n} layout instead of legacy${n} layout ${"qwxyz".repeat(2)}${n}`;
      lines.push(
        "commit refs/heads/main",
        `committer T <t@e.com> ${Math.floor(Date.now() / 1000) - n} +0000`,
        `data ${Buffer.byteLength(msg)}`,
        msg,
        `M 644 inline src/f${n}.txt`,
        "data 1",
        "x",
        "",
      );
    }
    execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: lines.join("\n") });
    const { root } = await vault({ root: dir });
    const handle = await openVault(root);
    const { candidates, commits } = await harvestCandidates(handle.plan, dir, "30d");
    assert.equal(commits, 300);
    assert.ok(candidates.length <= 15, `got ${candidates.length}`);
    const assigned = candidates.map((c) => ({ ...c, project: "Meridian" }));
    assert.ok(capPerProject([...assigned, ...assigned]).length <= 15);
  });

  it(
    "FINDING: one 20 MB commit body grows RSS by more than 10x its size",
    {
      todo: "src/memory/harvest.ts:readCommits keeps whole bodies; src/memory/extract.ts:sentencesOf regex copies; see report",
    },
    async () => {
      const dir = await tempDir();
      tempDirs.push(dir);
      git(dir, "init", "-q");
      git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
      const body = `We keep this because tests need it.\n${"filler words here ".repeat(1_200_000)}`;
      const msg = `Big body\n\n${body}`;
      const input = [
        "commit refs/heads/main",
        `committer T <t@e.com> ${Math.floor(Date.now() / 1000)} +0000`,
        `data ${Buffer.byteLength(msg)}`,
        msg,
        "M 644 inline meridian/a.txt",
        "data 1",
        "x",
        "",
      ].join("\n");
      execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input, maxBuffer: 1 << 28 });
      const { plan } = await openVault((await vault({ root: dir })).root);
      const rssBefore = process.memoryUsage().rss;
      const { candidates } = await harvestCandidates(plan, dir, "30d");
      const growth = process.memoryUsage().rss - rssBefore;
      assert.equal(candidates.length, 1);
      assert.ok(candidates[0].text.length < 400, `text ${candidates[0].text.length} chars`);
      assert.ok(growth < 200 * 1024 * 1024, `rss grew ${Math.round(growth / 1e6)} MB`);
    },
  );

  it("a commit touching thousands of files records at most 20 paths", async () => {
    const dir = await tempDir();
    tempDirs.push(dir);
    git(dir, "init", "-q");
    git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
    const lines = [
      "commit refs/heads/main",
      `committer T <t@e.com> ${Math.floor(Date.now() / 1000)} +0000`,
    ];
    const msg = "Split everything because one folder got unmanageable";
    lines.push(`data ${msg.length}`, msg);
    for (let n = 0; n < 3000; n += 1) lines.push(`M 644 inline meridian/f${n}.txt`, "data 1", "x");
    lines.push("");
    execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: lines.join("\n") });
    const { plan } = await openVault((await vault({ root: dir })).root);
    const { candidates } = await harvestCandidates(plan, dir, "30d");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].commit!.paths.length, 20);
    assert.equal(candidates[0].project, "Meridian");
  });

  it(
    "FINDING: history larger than the 64 MB git buffer is reported as 'no commits to read'",
    {
      todo: "src/util/git.ts:12 maxBuffer; src/memory/harvest.ts:readCommits swallows ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    },
    async () => {
      const dir = await tempDir();
      tempDirs.push(dir);
      git(dir, "init", "-q");
      git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
      const lines: string[] = [];
      const msg = `Big because reasons\n\n${"x".repeat(24 * 1024 * 1024)}`;
      for (let n = 0; n < 3; n += 1) {
        lines.push(
          "commit refs/heads/main",
          `committer T <t@e.com> ${Math.floor(Date.now() / 1000) - n} +0000`,
          `data ${Buffer.byteLength(msg)}`,
          msg,
          `M 644 inline meridian/f${n}.txt`,
          "data 1",
          "x",
          "",
        );
      }
      execFileSync("git", ["fast-import", "--quiet"], {
        cwd: dir,
        input: lines.join("\n"),
        maxBuffer: 1 << 28,
      });
      const { plan } = await openVault((await vault({ root: dir })).root);
      await assert.rejects(harvestCandidates(plan, dir, "30d"), (error: Error) => {
        assert.ok(!/no commits to read/.test(error.message), error.message);
        return true;
      });
    },
  );
});

describe("redteam (e): the operator's notes stay the operator's", () => {
  it("a hand-written section survives harvest and repair byte for byte, and gets no harvest provenance", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const { root, input } = await vault({ root: repo.dir });
    const path = resolve(root, DECISIONS);
    const mine = "\n## My own call\n\nI decided this myself, nobody harvested it.\n";
    await writeFile(path, `${await readFile(path, "utf8")}${mine}`, "utf8");
    const before = await readFile(path, "utf8");

    await harvestAll(root, repo.dir, "decision");
    const after = await readFile(path, "utf8");
    assert.ok(after.startsWith(before.replace(/\n*$/, "\n")), "harvest altered existing text");
    const sections = parseSections(DECISIONS, after);
    const own = sections.find((s) => s.heading === "My own call")!;
    assert.equal(own.commit, undefined);
    assert.equal(own.paths, undefined);
    assert.ok(!/harvest/.test(own.source ?? ""));

    const generated = generateFiles(input).files;
    await writeFiles(root, generated, { repair: true });
    assert.equal(await readFile(path, "utf8"), after, "repair rewrote the Decisions note");
    assert.ok(generated.find((f) => f.path === DECISIONS)!.kind === "seed");
  });

  it("an operator section is never marked as code-backed or drifting by harvest", async () => {
    const repo = await codeRepo();
    await repo.commit("meridian/a.txt", "1", "Pin node because newer majors break the build");
    const { root, input } = await vault({ root: repo.dir });
    const path = resolve(root, DECISIONS);
    await writeFile(
      path,
      `${await readFile(path, "utf8")}\n## Hand note\n\nKeep the cache small because RAM is tight.\n`,
      "utf8",
    );
    await harvestAll(root, repo.dir, "decision");
    await repo.commit("meridian/a.txt", "2", "Bump a");
    const drift = (await runDoctor(root, input)).findings.filter((f) => f.code === "CODE-DRIFT");
    assert.ok(drift.every((f) => !/Hand note/.test(f.message)));
    assert.equal(drift.length, 1);
  });

  it("a commit subject that starts with a lifecycle field cannot forge it in the written section", async () => {
    const repo = await codeRepo();
    await repo.commit(
      "meridian/a.txt",
      "1",
      "valid-until:: 2020-01-01 we drop this because nobody reads it",
    );
    const { root } = await vault({ root: repo.dir });
    await harvestAll(root, repo.dir, "decision");
    const sections = parseSections(DECISIONS, await readFile(resolve(root, DECISIONS), "utf8"));
    const written = sections.find((s) => s.commit);
    assert.ok(written, "harvested section not found");
    assert.equal(written.validUntil, undefined, "commit text set valid-until");
  });
});
