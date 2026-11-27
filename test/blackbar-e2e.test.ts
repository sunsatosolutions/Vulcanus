import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { importCommand } from "../src/commands/import.js";
import { installHooksCommand } from "../src/commands/hooks.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const exec = promisify(execFile);
const tempDirs: string[] = [];
before(() => setLogLevel("quiet"));
after(async () => {
  setLogLevel("normal");
  for (const dir of tempDirs) await cleanup(dir);
});

// Built at run time: no token-shaped text sits in the repo.
const body = (seed: string) => seed.repeat(8).slice(0, 36);
const CHAT_KEY = `${["gh", "p_"].join("")}${body("aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC")}`;
const HAND_KEY = `${["gh", "p_"].join("")}${body("Zy9xW7vU5tS3rQ1pN8mK6jH4gE2dB0aC")}`;
const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";

const decide: PromptDriver = {
  text: async (request) => request.initialValue ?? "",
  select: async (request) =>
    request.options.some((o) => o.value === "decision") ? "decision" : "",
  multiselect: async () => {
    throw new Error("unexpected multiselect");
  },
  confirm: async () => false,
};

async function everything(dir: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.parentPath.includes(`${"/"}.git`)) continue;
    const path = join(entry.parentPath, entry.name);
    out.push([path, await readFile(path, "utf8")]);
  }
  return out;
}

describe("Blackbar first-day flow", () => {
  it("masks a chat transcript on import, then the pre-commit hook refuses a hand-written key", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const root = await tempDir();
    tempDirs.push(root);
    await writeFiles(root, generateFiles(input).files);
    await writeManifest(root, input);

    // The box injects core.hooksPath through the environment, pointing outside the repository.
    const env = { ...process.env, GIT_CONFIG_COUNT: "0" };
    const bin = resolve(root, "..", `bin-${root.split("/").pop()}`);
    const git = (...args: string[]) =>
      exec(
        "git",
        [
          "-c",
          "user.name=T",
          "-c",
          "user.email=t@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: root, env: { ...env, PATH: `${bin}:${process.env.PATH}` } },
      );
    await exec("git", ["init", "--quiet"], { cwd: root, env });

    // 1. Import a chat transcript that holds a key.
    const chats = await tempDir();
    tempDirs.push(chats);
    await mkdir(join(chats, "Meridian"), { recursive: true });
    await writeFile(
      join(chats, "Meridian", "chat.md"),
      `# Deploy chat\n\nUser: We decided ${CHAT_KEY} is the Meridian deploy token from now on.\n\nAssistant: Noted.\n`,
    );
    const screen: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const writeErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk: string) => (screen.push(String(chunk)), true);
    process.stderr.write = (chunk: string) => (screen.push(String(chunk)), true);
    setLogLevel("normal");
    const restore = setPromptDriver(decide);
    try {
      assert.equal(
        await importCommand({ cwd: root, source: "markdown", path: chats, memoryOnly: true }),
        0,
      );
    } finally {
      restore();
      setLogLevel("quiet");
      process.stdout.write = write;
      process.stderr.write = writeErr;
    }

    const note = await readFile(resolve(root, DECISIONS), "utf8");
    assert.match(note, /\[REDACTED:github-token\]/);
    assert.ok(screen.join("").length > 0, "the import printed nothing");
    assert.equal(screen.join("").includes(CHAT_KEY), false, "the terminal showed the raw key");
    for (const [path, text] of await everything(root)) {
      assert.equal(text.includes(CHAT_KEY), false, `raw key in ${path}`);
    }

    // 2. Install the hook; a key typed into the vault by hand stops the commit.
    const injected = process.env.GIT_CONFIG_COUNT;
    process.env.GIT_CONFIG_COUNT = "0";
    try {
      assert.equal(await installHooksCommand({ cwd: root }), 0);
    } finally {
      if (injected === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = injected;
    }
    await mkdir(bin);
    const tsx = pathToFileURL(resolve("node_modules/tsx/dist/esm/index.mjs")).href;
    // doctor and emit have their own tests; the shim runs the real `hooks scan-staged`.
    await writeFile(
      resolve(bin, "vulcanus"),
      `#!/bin/sh\n[ "$1" = doctor ] && exit 0\n[ "$1" = emit ] && exit 0\nexec "${process.execPath}" --import "${tsx}" "${resolve("src/cli.ts")}" "$@"\n`,
    );
    await chmod(resolve(bin, "vulcanus"), 0o755);

    await writeFile(resolve(root, DECISIONS), `${note}\nManual: ${HAND_KEY}\n`);
    await git("add", "-A");
    await assert.rejects(git("commit", "-q", "-m", "leak"), (error: { stderr: string }) => {
      assert.match(error.stderr, /Meridian Decisions\.md:\d+ github-token/);
      assert.equal(error.stderr.includes(HAND_KEY), false, "the hook printed the key");
      return true;
    });

    // 3. Taking the key out lets the commit through.
    await writeFile(resolve(root, DECISIONS), note);
    await git("add", "-A");
    await git("commit", "-q", "-m", "clean");
    assert.match((await git("log", "--oneline")).stdout, /clean/);
  });
});
