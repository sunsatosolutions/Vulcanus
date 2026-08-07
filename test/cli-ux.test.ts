import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { completionCommand, completionScript, SHELLS } from "../src/commands/completion.js";
import { installHooksCommand, uninstallHooksCommand } from "../src/commands/hooks.js";
import { collectStats, estimateTokens, statsCommand } from "../src/commands/stats.js";
import { badChoiceProblem, formatProblem, noVaultProblem, EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { toPosix, vaultRelative } from "../src/util/paths.js";
import { isVerbose, logLevel, setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const run = promisify(execFile);
const tempDirs: string[] = [];

/** A real repository: the hook path comes from git itself, not from guessing. */
async function gitInit(root: string): Promise<void> {
  await run("git", ["init", "--quiet"], { cwd: root });
}

async function scaffold() {
  const root = await tempDir();
  tempDirs.push(root);
  const input = manifest({ projects: [project("alpha", "Alpha"), project("beta", "Beta")] });
  const { files } = generateFiles(input);
  await writeFiles(root, files);
  await writeManifest(root, input);
  return root;
}

async function captureStdout<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    const result = await action();
    return { result, output: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

async function captureStderr<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    const result = await action();
    return { result, output: chunks.join("") };
  } finally {
    process.stderr.write = original;
  }
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

describe("error reporting", () => {
  it("says what happened, why, and what to do", () => {
    const text = formatProblem(noVaultProblem("/tmp/somewhere", "vulcanus doctor"));
    assert.match(text, /vulcanus doctor needs a vulcanus\.json/);
    assert.match(text, /why: .*\/tmp\/somewhere/);
    assert.match(text, /fix: /);
    // Every fix line is indented under the same block, so a multi-line fix
    // cannot be mistaken for a new problem.
    for (const line of text.trimEnd().split("\n").slice(1)) {
      assert.match(line, /^ {2,}/);
    }
  });

  it("names the allowed values for a bad flag", () => {
    const text = formatProblem(badChoiceProblem("--profile", "deep", ["core", "full"]));
    assert.match(text, /--profile does not accept "deep"/);
    assert.match(text, /core, full/);
  });

  it("keeps the exit code contract stable", () => {
    assert.deepEqual(EXIT, { ok: 0, failed: 1, usage: 2, cancelled: 130 });
  });
});

describe("log levels", () => {
  it("suppresses output at quiet and adds detail at verbose", () => {
    setLogLevel("quiet");
    assert.equal(logLevel(), "quiet");
    assert.equal(isVerbose(), false);

    setLogLevel("verbose");
    assert.equal(isVerbose(), true);

    setLogLevel("normal");
    assert.equal(isVerbose(), false);
  });
});

describe("vault paths", () => {
  it("keeps vault-internal paths in forward-slash form", () => {
    assert.equal(toPosix("00_System/Index.md"), "00_System/Index.md");
    assert.equal(vaultRelative("/vault", "/vault/00_System/Index.md"), "00_System/Index.md");
    // The relative path is what doctor compares against planned paths, so it
    // must never carry a platform separator into the comparison.
    assert.ok(!vaultRelative("/vault", "/vault/a/b.md").includes("\\"));
  });
});

describe("stats", () => {
  it("estimates tokens from characters", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
  });

  it("reports a cold start that costs less than the whole vault", async () => {
    const root = await scaffold();
    const summary = await collectStats(root);

    assert.equal(summary.projects.length, 2);
    assert.ok(summary.coldStart.tokens > 0);
    assert.ok(summary.typicalRecall.tokens > summary.coldStart.tokens);
    assert.ok(summary.everything > summary.typicalRecall.tokens);
    assert.ok(summary.savedShare > 0 && summary.savedShare < 1);

    // Every project's capsule is cheaper than reading its whole cluster —
    // that gap is the entire reason the capsule layer exists.
    for (const entry of summary.projects) {
      assert.ok(
        entry.capsuleTokens < entry.clusterTokens,
        `${entry.project}: capsule must be cheaper than the cluster`,
      );
    }
  });

  it("prints JSON that a script can read", async () => {
    const root = await scaffold();
    const { result, output } = await captureStdout(() => statsCommand({ cwd: root, json: true }));
    assert.equal(result, 0);
    const parsed = JSON.parse(output) as { vault: string; projects: unknown[] };
    assert.equal(parsed.vault, "ATLAS");
    assert.equal(parsed.projects.length, 2);
  });

  it("refuses outside a vault with the usage exit code", async () => {
    const empty = await tempDir();
    tempDirs.push(empty);
    const { result } = await captureStderr(() => statsCommand({ cwd: empty }));
    assert.equal(result, EXIT.usage);
  });
});

describe("shell completion", () => {
  for (const shell of SHELLS) {
    it(`${shell}: lists every command`, () => {
      const script = completionScript(shell);
      for (const command of ["init", "status", "stats", "doctor", "serve", "sync", "hooks"]) {
        assert.ok(script.includes(command), `${shell} completion must mention ${command}`);
      }
    });
  }

  it("rejects an unknown shell with the supported list", async () => {
    const { result, output } = await captureStderr(async () => completionCommand("tcsh"));
    assert.equal(result, EXIT.usage);
    assert.match(output, /bash, zsh, fish, pwsh/);
  });

  it("prints the script for a known shell", async () => {
    const { result, output } = await captureStdout(async () => completionCommand("bash"));
    assert.equal(result, 0);
    assert.match(output, /complete -F _vulcanus vulcanus/);
  });
});

describe("git hooks", () => {
  it("installs a pre-commit hook that runs doctor", async () => {
    const root = await scaffold();
    await gitInit(root);

    const code = await installHooksCommand({ cwd: root });
    assert.equal(code, 0);

    const hook = await readFile(resolve(root, ".git/hooks/pre-commit"), "utf8");
    assert.match(hook, /vulcanus doctor/);
    assert.match(hook, /installed by vulcanus/);
  });

  it("refuses to overwrite a hook it did not write", async () => {
    const root = await scaffold();
    await gitInit(root);
    await writeFile(resolve(root, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n", "utf8");

    const { result, output } = await captureStderr(() => installHooksCommand({ cwd: root }));
    assert.equal(result, EXIT.usage);
    assert.match(output, /--force/);

    // …and leaves the operator's hook exactly as it was.
    const hook = await readFile(resolve(root, ".git/hooks/pre-commit"), "utf8");
    assert.match(hook, /echo mine/);
  });

  it("removes only its own hook", async () => {
    const root = await scaffold();
    await gitInit(root);
    await writeFile(resolve(root, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n", "utf8");

    const { result } = await captureStderr(() => uninstallHooksCommand({ cwd: root }));
    assert.equal(result, EXIT.usage);

    await installHooksCommand({ cwd: root, force: true });
    assert.equal(await uninstallHooksCommand({ cwd: root }), 0);
  });
});
