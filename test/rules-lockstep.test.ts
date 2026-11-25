import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";
import { installHooksCommand } from "../src/commands/hooks.js";
import { rulesCheckCommand, rulesLinkCommand } from "../src/commands/rules.js";
import { syncCommand } from "../src/commands/sync.js";
import { runDoctor } from "../src/doctor/index.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import type { RulesReport } from "../src/memory/rules.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const run = promisify(execFile);
const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const NAMES = ["Alpha", "Beta", "Gamma"];
const capsulePath = (name: string) => `02_Projects/${name}/${name} Capsule.md`;
/** The generated Capsule with its Must Remember bullets replaced, so doctor stays clean. */
const withRules = (generated: string, name: string, extra = "") =>
  generated.replace(
    /(## Must Remember\n)[\s\S]*?(?=\n## )/,
    `$1\n- ${name} starts at \`src/index.ts\`.\n- Build with \`npm run build\` before you commit.\n- Settings live in \`config/app.json\`.\n${extra}\n`,
  );
async function setRules(vault: string, name: string, extra = "") {
  const path = resolve(vault, capsulePath(name));
  await writeFile(path, withRules(await readFile(path, "utf8"), name, extra));
}

/** One vault, three projects, each with its own code repository as `root`. */
async function lockstep() {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const codes = NAMES.map((name) => resolve(parent, name.toLowerCase()));
  const input = manifest({
    projects: NAMES.map((name, index) => project(name.toLowerCase(), name, { root: codes[index] })),
  });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  for (const [index, name] of NAMES.entries()) {
    await setRules(vault, name);
    const files: Record<string, string> = {
      "src/index.ts": "export {};\n",
      "config/app.json": "{}\n",
      "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(resolve(codes[index], path)), { recursive: true });
      await writeFile(resolve(codes[index], path), text);
    }
  }
  return { vault, codes };
}

async function capture<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    return { result: await action(), output: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

async function linkAll(vault: string) {
  setLogLevel("quiet");
  for (const name of NAMES) {
    assert.equal(await rulesLinkCommand(name, { cwd: vault, write: true }), EXIT.ok);
  }
}

/** Break one rule per repository: a text divergence, a deleted path, a deleted script. */
async function breakThree(codes: string[]) {
  const claude = resolve(codes[0], "CLAUDE.md");
  await writeFile(
    claude,
    (await readFile(claude, "utf8")).replace("Build with `npm run build`", "Build however"),
  );
  await rm(resolve(codes[1], "config"), { recursive: true });
  await writeFile(resolve(codes[2], "package.json"), JSON.stringify({ scripts: {} }));
}

async function checkJson(code: string) {
  const { result, output } = await capture(() => rulesCheckCommand({ root: code, json: true }));
  return { exit: result, report: JSON.parse(output) as RulesReport };
}

describe("lockstep end to end", () => {
  it("catches 3 of 3 deliberate breaks across three repositories", async () => {
    const { vault, codes } = await lockstep();
    await linkAll(vault);
    for (const code of codes) assert.equal((await checkJson(code)).report.ok, true);

    await breakThree(codes);
    const kinds = [];
    for (const code of codes) {
      const { exit, report } = await checkJson(code);
      assert.equal(exit, EXIT.failed);
      kinds.push(new Set(report.findings.map((finding) => finding.kind)));
    }
    assert.deepEqual(kinds, [new Set(["divergent"]), new Set(["path"]), new Set(["script"])]);

    // Without --root the command walks every linked repository.
    const all = await capture(() => rulesCheckCommand({ cwd: vault, json: true }));
    assert.equal(all.result, EXIT.failed);
    const reports = JSON.parse(all.output) as RulesReport[];
    assert.equal(reports.length, 3);
    assert.equal(reports.filter((report) => !report.ok).length, 3);
  });

  it("doctor reports the same drift as RULES-DRIFT warnings, and nothing when clean", async () => {
    const { vault, codes } = await lockstep();
    await linkAll(vault);
    const clean = await runDoctor(vault, await readManifest(vault));
    assert.equal(clean.findings.filter((f) => f.code === "RULES-DRIFT").length, 0);

    await breakThree(codes);
    const report = await runDoctor(vault, await readManifest(vault));
    const drift = report.findings.filter((f) => f.code === "RULES-DRIFT");
    assert.ok(drift.every((f) => f.level === "warning"));
    for (const [name, pattern] of [
      ["Alpha", /divergent .*Build however/],
      ["Beta", /path `config\/app\.json`/],
      ["Gamma", /script `npm run build`/],
    ] as const) {
      assert.ok(
        drift.some((f) => f.message.startsWith(`${name}:`) && pattern.test(f.message)),
        name,
      );
    }
    assert.equal(report.ok, true);
  });

  it("link without a project refreshes linked repositories after a Capsule change", async () => {
    const { vault, codes } = await lockstep();
    // Only Alpha and Beta are linked; Gamma has never been linked and stays alone.
    setLogLevel("quiet");
    await rulesLinkCommand("Alpha", { cwd: vault, write: true });
    await rulesLinkCommand("Beta", { cwd: vault, write: true });
    await setRules(vault, "Alpha", "- Never push to `main`.");

    // Dry run by default: nothing moves.
    const before = await readFile(resolve(codes[0], "AGENTS.md"), "utf8");
    assert.equal(await rulesLinkCommand(undefined, { cwd: vault }), EXIT.ok);
    assert.equal(await readFile(resolve(codes[0], "AGENTS.md"), "utf8"), before);

    assert.equal(await rulesLinkCommand(undefined, { cwd: vault, write: true }), EXIT.ok);
    assert.match(await readFile(resolve(codes[0], "AGENTS.md"), "utf8"), /Never push to `main`/);
    assert.equal(
      await readFile(resolve(codes[1], "AGENTS.md"), "utf8").then((t) => t.length > 0),
      true,
    );
    await assert.rejects(readFile(resolve(codes[2], "AGENTS.md"), "utf8"), { code: "ENOENT" });
  });

  it("sync hints at stale rules, and writes them only with --write-rules", async () => {
    const { vault, codes } = await lockstep();
    setLogLevel("quiet");
    await rulesLinkCommand("Alpha", { cwd: vault, write: true });
    await setRules(vault, "Alpha", "- Never push to `main`.");
    const agents = resolve(codes[0], "AGENTS.md");
    const before = await readFile(agents, "utf8");

    const hinted = await capture(() => syncCommand({ cwd: vault, json: true }));
    assert.equal(hinted.result, 0);
    assert.deepEqual((JSON.parse(hinted.output) as { rules: unknown }).rules, {
      repos: 1,
      pending: 3,
      written: false,
      failed: [],
    });
    assert.equal(await readFile(agents, "utf8"), before);

    const dry = await capture(() =>
      syncCommand({ cwd: vault, json: true, writeRules: true, dryRun: true }),
    );
    assert.equal((JSON.parse(dry.output) as { rules: { written: boolean } }).rules.written, false);
    assert.equal(await readFile(agents, "utf8"), before);

    const wrote = await capture(() => syncCommand({ cwd: vault, json: true, writeRules: true }));
    assert.deepEqual((JSON.parse(wrote.output) as { rules: unknown }).rules, {
      repos: 1,
      pending: 3,
      written: true,
      failed: [],
    });
    assert.match(await readFile(agents, "utf8"), /Never push to `main`/);
  });
});

describe("pre-commit hook runs rules check", () => {
  it("stops the commit when rules check fails, and passes when it holds", async () => {
    const parent = await tempDir();
    tempDirs.push(parent);
    await run("git", ["init", "-q"], { cwd: parent });
    const vault = resolve(parent, "vault");
    await mkdir(vault);
    const input = manifest();
    await writeFiles(vault, generateFiles(input).files);
    await writeManifest(vault, input);
    // A host may force core.hooksPath through GIT_CONFIG_*; the hook must land in this repository.
    const forced = process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_COUNT;
    try {
      assert.equal(await installHooksCommand({ cwd: vault }), 0);
    } finally {
      if (forced !== undefined) process.env.GIT_CONFIG_COUNT = forced;
    }
    const hookPath = resolve(parent, ".git/hooks/pre-commit");
    const hook = await readFile(hookPath, "utf8");
    assert.match(hook, /vulcanus rules check --json/);

    if (process.platform === "win32") return;
    // Stub CLI: doctor passes; rules check fails when $RULES_FAIL is set.
    const bin = resolve(parent, "bin");
    await mkdir(bin);
    await writeFile(
      resolve(bin, "vulcanus"),
      '#!/bin/sh\necho "$@" >> "$CALLS"\n[ "$1" = rules ] && [ -n "$RULES_FAIL" ] && exit 1\nexit 0\n',
    );
    await chmod(resolve(bin, "vulcanus"), 0o755);
    const calls = resolve(parent, "calls.txt");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls };

    await run("sh", [hookPath], { cwd: parent, env });
    assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), [
      "doctor --json",
      "rules check --json",
    ]);

    await assert.rejects(run("sh", [hookPath], { cwd: parent, env: { ...env, RULES_FAIL: "1" } }), {
      code: 1,
      stderr: /rules check found drift; commit refused/,
    });
  });
});

describe("sync with a real pre-commit hook", () => {
  it("refreshes drifted rules before the commit, so the hook lets it through", async () => {
    if (process.platform === "win32") return;
    const { vault, codes } = await lockstep();
    setLogLevel("quiet");
    await rulesLinkCommand("Alpha", { cwd: vault, write: true });
    const git = (args: string[]) => run("git", args, { cwd: vault });
    await git(["init", "-q"]);
    await git(["add", "-A"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "base",
      "--no-verify",
    ]);

    const bin = resolve(vault, "..", "bin");
    await mkdir(bin);
    const tsx = resolve("node_modules/.bin/tsx");
    const cli = resolve("src/cli.ts");
    await writeFile(resolve(bin, "vulcanus"), `#!/bin/sh\nexec '${tsx}' '${cli}' "$@"\n`);
    await chmod(resolve(bin, "vulcanus"), 0o755);

    const forced = process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_COUNT;
    const saved = { ...process.env };
    try {
      assert.equal(await installHooksCommand({ cwd: vault }), 0);
      Object.assign(process.env, {
        PATH: `${bin}:${process.env.PATH}`,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      });
      await setRules(vault, "Alpha", "- Never push to `main`.");
      // The copies diverge: the hook would refuse any commit until the refresh has run.
      const claude = resolve(codes[0], "CLAUDE.md");
      await writeFile(
        claude,
        (await readFile(claude, "utf8")).replace("Build with", "Build however with"),
      );
      await assert.rejects(run("sh", [resolve(vault, "../.git/hooks/pre-commit")], { cwd: vault }));
      const agents = resolve(codes[0], "AGENTS.md");
      assert.doesNotMatch(await readFile(agents, "utf8"), /Never push/);

      const { result, output } = await capture(() =>
        syncCommand({ cwd: vault, json: true, writeRules: true }),
      );
      assert.equal(result, 0);
      const summary = JSON.parse(output) as { committed: string | null };
      assert.ok(summary.committed);
      assert.match(await readFile(agents, "utf8"), /Never push to `main`/);
    } finally {
      for (const key of [
        "PATH",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
      ]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      if (forced !== undefined) process.env.GIT_CONFIG_COUNT = forced;
    }
  });
});

describe("a plan that cannot be made is reported", () => {
  it("sync names the damaged repository and fails when a refresh was requested", async () => {
    const { vault, codes } = await lockstep();
    setLogLevel("quiet");
    await rulesLinkCommand("Alpha", { cwd: vault, write: true });
    await rulesLinkCommand("Beta", { cwd: vault, write: true });
    const agents = resolve(codes[0], "AGENTS.md");
    await writeFile(
      agents,
      (await readFile(agents, "utf8")).replace("<!-- vulcanus:rules:end -->", ""),
    );
    await setRules(vault, "Beta", "- Never push to `main`.");

    const hinted = await capture(() => syncCommand({ cwd: vault, json: true }));
    assert.equal(hinted.result, 0);
    const rules = (
      JSON.parse(hinted.output) as { rules: { failed: { project: string }[]; pending: number } }
    ).rules;
    assert.deepEqual(
      rules.failed.map((f) => f.project),
      ["Alpha"],
    );
    assert.equal(rules.pending, 3);

    const asked = await capture(() => syncCommand({ cwd: vault, json: true, writeRules: true }));
    assert.equal(asked.result, 1);
    assert.match(await readFile(resolve(codes[1], "AGENTS.md"), "utf8"), /Never push to `main`/);
  });
});
