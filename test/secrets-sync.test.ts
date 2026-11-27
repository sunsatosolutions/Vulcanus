import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { installHooksCommand } from "../src/commands/hooks.js";
import { syncCommand, type SyncSummary } from "../src/commands/sync.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { writeManifest } from "../src/manifest/io.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const run = promisify(execFile);

// Built at run time: no token-shaped text sits in the repo.
const KEY = `${["AK", "IA"].join("")}${"7Q2".repeat(6).slice(0, 16)}`;
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
  GIT_CONFIG_COUNT: "0",
};
const saved = { ...process.env };
const tempDirs: string[] = [];

before(() => {
  setLogLevel("quiet");
  Object.assign(process.env, IDENTITY);
});
after(async () => {
  setLogLevel("normal");
  for (const key of Object.keys(IDENTITY)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const dir of tempDirs) await cleanup(dir);
});

const git = async (cwd: string, ...args: string[]) =>
  (await run("git", args, { cwd })).stdout.trim();

/** A vault under git with one baseline commit. */
async function vault() {
  const root = await tempDir();
  tempDirs.push(root);
  const input = manifest({ projects: [project("alpha", "Alpha")] });
  await writeFiles(root, generateFiles(input).files);
  await writeManifest(root, input);
  await git(root, "init", "--quiet");
  await git(root, "add", "-A");
  await git(root, "commit", "--quiet", "-m", "base");
  return { root, note: resolve(root, buildPlan(input).allProjects[0].capsule.path) };
}

async function capture(action: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await action(), out: chunks.join("") };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

describe("sync secret gate", () => {
  it("stops on a secret typed into a note: exit 1, no commit, no value", async () => {
    const { root, note } = await vault();
    const before = await git(root, "rev-parse", "HEAD");
    await writeFile(
      note,
      `${await (await import("node:fs/promises")).readFile(note, "utf8")}\nkey ${KEY}\n`,
    );

    setLogLevel("normal");
    const { code, out } = await capture(() => syncCommand({ cwd: root }));
    setLogLevel("quiet");
    assert.equal(code, 1);
    assert.equal(await git(root, "rev-parse", "HEAD"), before);
    assert.match(out, /:\d+ aws-key [0-9a-f]{12}/);
    assert.equal(out.includes(KEY), false);
  });

  it("stops on a secret in a file that is not a note", async () => {
    const { root } = await vault();
    const before = await git(root, "rev-parse", "HEAD");
    await writeFile(resolve(root, "scratch.txt"), `a\nb\nexport K=${KEY}\n`);

    const { code, out } = await capture(() => syncCommand({ cwd: root, json: true }));
    assert.equal(code, 1);
    const summary = JSON.parse(out) as SyncSummary;
    assert.equal(summary.reason, "secrets-found");
    assert.equal(summary.committed, null);
    assert.match(summary.secrets[0], /^scratch\.txt:3 aws-key [0-9a-f]{12}$/);
    assert.equal(out.includes(KEY), false);
    assert.equal(await git(root, "rev-parse", "HEAD"), before);
  });

  it("passes with a reasoned .vulcanus-allow entry, not without a reason", async () => {
    const { root } = await vault();
    await writeFile(resolve(root, "scratch.txt"), `export K=${KEY}\n`);

    await writeFile(resolve(root, ".vulcanus-allow"), "scratch.txt:1:aws-key\n");
    assert.equal((await capture(() => syncCommand({ cwd: root, json: true }))).code, 1);
    assert.equal(await git(root, "log", "--format=%s", "-1"), "base");

    await writeFile(resolve(root, ".vulcanus-allow"), "scratch.txt:1:aws-key # test fixture\n");
    const { code, out } = await capture(() => syncCommand({ cwd: root, json: true }));
    assert.equal(code, 0, out);
    assert.notEqual(await git(root, "log", "--format=%s", "-1"), "base");
  });
});

describe("pre-commit secret gate", { skip: process.platform === "win32" && "sh hook" }, () => {
  async function hooked() {
    const { root } = await vault();
    assert.equal(await installHooksCommand({ cwd: root }), 0);
    const bin = resolve(root, "..", `bin-${resolve(root).length}-${Date.now()}`);
    await mkdir(bin);
    // doctor and emit are stubbed: the fixture vault is not their subject, the secret check is.
    await writeFile(
      resolve(bin, "vulcanus"),
      `#!/bin/sh\n[ "$1" = doctor ] && exit 0\n[ "$1" = emit ] && exit 0\nexec "${process.execPath}" --import "${pathToFileURL(resolve("node_modules/tsx/dist/esm/index.mjs")).href}" "${resolve("src/cli.ts")}" "$@"\n`,
    );
    await chmod(resolve(bin, "vulcanus"), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const commit = (message: string) =>
      run("git", ["commit", "-m", message], { cwd: root, env }).then(
        () => 0,
        (error: { code: number }) => error.code,
      );
    return { root, commit };
  }

  it("refuses a commit that stages a secret, passes a clean one", async () => {
    const { root, commit } = await hooked();
    await writeFile(resolve(root, "clean.txt"), "nothing here\n");
    await git(root, "add", "clean.txt");
    assert.equal(await commit("clean"), 0);

    await writeFile(resolve(root, "leak.txt"), `K=${KEY}\n`);
    await git(root, "add", "leak.txt");
    const head = await git(root, "rev-parse", "HEAD");
    assert.equal(await commit("leak"), 1);
    assert.equal(await git(root, "rev-parse", "HEAD"), head);

    // The index is what counts: a clean working copy does not hide a staged secret.
    await writeFile(resolve(root, "leak.txt"), "gone\n");
    assert.equal(await commit("still staged"), 1);

    await writeFile(resolve(root, ".vulcanus-allow"), "leak.txt:1:aws-key # test fixture\n");
    await git(root, "add", "-A");
    assert.equal(await commit("clean now"), 0);
  });
});
