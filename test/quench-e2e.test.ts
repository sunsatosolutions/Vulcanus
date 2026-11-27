import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { doctorCommand } from "../src/commands/doctor.js";
import { scanStagedCommand, installHooksCommand } from "../src/commands/hooks.js";
import { importCommand } from "../src/commands/import.js";
import { syncCommand } from "../src/commands/sync.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest, readManifest } from "../src/manifest/io.js";
import { appendDecision, appendRule, openVault, updateCapsule } from "../src/mcp/tools.js";
import { hasSecret, scanText } from "../src/secrets/detector.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

/*
 * Quench: the first-day scenario, end to end, then evasion attempts.
 * Every secret is built at run time; no token-shaped text sits in the repo.
 */

const exec = promisify(execFile);
const tempDirs: string[] = [];
const injectedGitConfig = process.env.GIT_CONFIG_COUNT;
before(() => {
  setLogLevel("quiet");
  // The box injects core.hooksPath through the environment, pointing outside the repository.
  process.env.GIT_CONFIG_COUNT = "0";
});
after(async () => {
  setLogLevel("normal");
  if (injectedGitConfig === undefined) delete process.env.GIT_CONFIG_COUNT;
  else process.env.GIT_CONFIG_COUNT = injectedGitConfig;
  for (const dir of tempDirs) await cleanup(dir);
});

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const randomBody = (length: number, alphabet = UPPER) =>
  Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
/** Fresh each call; always carries a digit and a letter so no filter can mistake it for prose. */
const awsKey = () => `${["AK", "IA"].join("")}${randomBody(14)}7Q`;

const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const RULES = "02_Projects/Meridian/Meridian Rules.md";
const CAPSULE = "02_Projects/Meridian/Meridian Capsule.md";
const INPUT = manifest({ projects: [project("meridian", "Meridian")] });

const decide: PromptDriver = {
  text: async (request) => request.initialValue ?? "",
  select: async (request) =>
    request.options.some((o) => o.value === "decision") ? "decision" : "",
  multiselect: async () => {
    throw new Error("unexpected multiselect");
  },
  confirm: async () => false,
};

async function scaffold(): Promise<string> {
  const root = await tempDir();
  tempDirs.push(root);
  await writeFiles(root, generateFiles(INPUT).files);
  await writeManifest(root, INPUT);
  return root;
}

async function everything(dir: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.parentPath.includes(`${"/"}.git`)) continue;
    const path = join(entry.parentPath, entry.name);
    out.push([path, await readFile(path, "utf8")]);
  }
  return out;
}

/** Run `fn` with stdout and stderr captured; returns what was printed. */
async function capture<T>(
  fn: () => Promise<T>,
  level: "normal" | "quiet" = "normal",
): Promise<{ result: T; screen: string }> {
  const screen: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string) => (screen.push(String(chunk)), true);
  process.stderr.write = (chunk: string) => (screen.push(String(chunk)), true);
  setLogLevel(level);
  try {
    return { result: await fn(), screen: screen.join("") };
  } finally {
    setLogLevel("quiet");
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

interface Repo {
  root: string;
  bare: string;
  git: (...args: string[]) => Promise<{ stdout: string; stderr: string }>;
  head: (cwd?: string) => Promise<string>;
}

/** A vault that is a git repo with a local bare `origin`; one clean commit pushed. */
async function repo(): Promise<Repo> {
  const root = await scaffold();
  const bare = await tempDir();
  tempDirs.push(bare);
  const ident = [
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "-c",
    "commit.gpgsign=false",
  ];
  const binDir = resolve(root, "..", `bin-${root.split("/").pop()}`);
  tempDirs.push(binDir);
  const git = (...args: string[]) =>
    exec("git", [...ident, ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
  await exec("git", ["init", "--quiet", "--bare"], { cwd: bare });
  await git("init", "--quiet");
  await git("remote", "add", "origin", bare);
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  await git("push", "-q", "origin", "HEAD");

  assert.equal(await installHooksCommand({ cwd: root }), 0);
  await mkdir(binDir, { recursive: true });
  const tsx = pathToFileURL(resolve("node_modules/tsx/dist/esm/index.mjs")).href;
  // doctor and emit have their own tests here; the shim runs the real `hooks scan-staged`.
  await writeFile(
    resolve(binDir, "vulcanus"),
    `#!/bin/sh\n[ "$1" = doctor ] && exit 0\n[ "$1" = emit ] && exit 0\nexec "${process.execPath}" --import "${tsx}" "${resolve("src/cli.ts")}" "$@"\n`,
  );
  await chmod(resolve(binDir, "vulcanus"), 0o755);

  const head = async (cwd = root) =>
    (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  return { root, bare, git, head };
}

const lineOfKey = (text: string, key: string) =>
  text.slice(0, text.indexOf(key)).split("\n").length;

// ---------------------------------------------------------------------------
// Yasin's first day: (a) to (e), one vault, in order.
// ---------------------------------------------------------------------------
describe("Quench first day", () => {
  const KEY = awsKey();
  const MASK = "[REDACTED:aws-key]";
  let r: Repo;
  let keyLine = 0;

  before(async () => {
    r = await repo();
  });

  it("(a) masks a ChatGPT export and a Claude Code transcript on import", async () => {
    const chatgpt = await tempDir();
    tempDirs.push(chatgpt);
    const node = (role: string, text: string) => ({
      message: { author: { role }, content: { content_type: "text", parts: [text] } },
    });
    await writeFile(
      join(chatgpt, "conversations.json"),
      JSON.stringify([
        {
          id: "c1",
          title: `Meridian deploy ${KEY}`,
          create_time: 1_700_000_000,
          update_time: 1_700_000_500,
          mapping: {
            n1: node("user", `We decided ${KEY} is the Meridian deploy key from now on.`),
            n2: node("assistant", "Noted."),
          },
        },
      ]),
    );

    const claude = await tempDir();
    tempDirs.push(claude);
    await mkdir(join(claude, "-work-Meridian"), { recursive: true });
    const line = (type: string, text: string) =>
      JSON.stringify({
        type,
        cwd: "/work/Meridian",
        timestamp: "2026-11-01T10:00:00.000Z",
        message: { role: type, content: text },
      });
    await writeFile(
      join(claude, "-work-Meridian", "s1.jsonl"),
      [
        line("user", `Meridian: we decided ${KEY} is the deploy key from now on.`),
        line("assistant", "Noted."),
      ].join("\n"),
    );

    const seen: string[] = [];
    for (const [source, path] of [
      ["chatgpt", chatgpt],
      ["claude-code", claude],
    ] as const) {
      // Candidate list as JSON.
      const asJson = await capture(
        () => importCommand({ cwd: r.root, source, path, json: true, all: true }),
        "quiet",
      );
      assert.equal(asJson.result, 0, `${source} --json failed`);
      assert.ok(asJson.screen.length > 0);
      JSON.parse(asJson.screen); // still valid JSON
      seen.push(asJson.screen);

      // Candidate list in the review prompts.
      const restore = setPromptDriver(decide);
      let reviewed;
      try {
        reviewed = await capture(() =>
          importCommand({ cwd: r.root, source, path, memoryOnly: true, all: true }),
        );
      } finally {
        restore();
      }
      assert.equal(reviewed.result, 0, `${source} review failed`);
      assert.ok(reviewed.screen.length > 0);
      seen.push(reviewed.screen);
    }

    for (const text of seen)
      assert.equal(text.includes(KEY), false, "the screen showed the raw key");
    const note = await readFile(resolve(r.root, DECISIONS), "utf8");
    assert.ok(note.includes(MASK), "the accepted note carries the mask");
    for (const [path, text] of await everything(r.root)) {
      assert.equal(text.includes(KEY), false, `raw key in ${path}`);
    }
  });

  it("(b) refuses the same key in MCP append_decision, naming the note and the kind", async () => {
    const handle = await openVault(r.root);
    const before = await readFile(resolve(r.root, DECISIONS), "utf8");
    await assert.rejects(
      appendDecision(handle, "Meridian", "Deploy", `Use ${KEY} to deploy.`),
      (error: Error) => {
        assert.match(error.message, /Refused to write/);
        assert.ok(error.message.includes("Meridian Decisions.md"), "names the note");
        assert.match(error.message, /aws-key \(line \d+\)/);
        assert.equal(error.message.includes(KEY), false, "the value is in the error");
        return true;
      },
    );
    assert.equal(await readFile(resolve(r.root, DECISIONS), "utf8"), before);
  });

  it("(c) a hand-written key stops `vulcanus sync` (exit 1, no commit) and the pre-commit hook", async () => {
    const path = resolve(r.root, DECISIONS);
    const note = await readFile(path, "utf8");
    const written = `${note}\nManual: ${KEY}\n`;
    keyLine = lineOfKey(written, KEY);
    await writeFile(path, written);

    const localBefore = await r.head();
    const remoteBefore = await r.head(r.bare);
    const synced = await capture(() => syncCommand({ cwd: r.root }));
    assert.equal(synced.result, 1);
    assert.equal(synced.screen.includes(KEY), false, "sync printed the key");
    assert.equal(await r.head(), localBefore, "sync committed");
    assert.equal(await r.head(r.bare), remoteBefore, "the remote moved");

    const asJson = await capture(() => syncCommand({ cwd: r.root, json: true }), "quiet");
    assert.equal(asJson.result, 1);
    assert.equal((JSON.parse(asJson.screen) as { committed: string | null }).committed, null);

    await r.git("add", "-A");
    await assert.rejects(r.git("commit", "-q", "-m", "leak"), (error: { stderr: string }) => {
      assert.match(error.stderr, /Meridian Decisions\.md:\d+ aws-key/);
      assert.equal(error.stderr.includes(KEY), false, "the hook printed the key");
      return true;
    });
    assert.equal(await r.head(), localBefore, "the hook let a commit through");
  });

  it("(d) doctor reports file:line and kind, never the value", async () => {
    const report = await runDoctor(r.root, await readManifest(r.root));
    const hit = report.findings.find((f) => f.code === "SECRET" && f.level === "error");
    assert.ok(hit, "no SECRET error");
    assert.equal(hit.file, DECISIONS);
    assert.equal(hit.line, keyLine);
    assert.match(hit.message, /^aws-key [0-9a-f]{12}$/);
    assert.equal(report.ok, false);
    assert.equal(JSON.stringify(report).includes(KEY), false);

    const human = await capture(() => doctorCommand({ cwd: r.root }));
    assert.equal(human.result, 1);
    assert.match(human.screen, new RegExp(`Meridian Decisions\\.md:${keyLine}`));
    assert.match(human.screen, /aws-key/);
    assert.equal(human.screen.includes(KEY), false, "doctor printed the key");

    const asJson = await capture(() => doctorCommand({ cwd: r.root, json: true }), "quiet");
    assert.equal(asJson.result, 1);
    assert.equal(asJson.screen.includes(KEY), false);
  });

  it("(e) .vulcanus-allow passes a reasoned entry and refuses one without a reason", async () => {
    const allowPath = resolve(r.root, ".vulcanus-allow");
    const secretErrors = async () =>
      (await runDoctor(r.root, await readManifest(r.root))).findings.filter(
        (f) => f.level === "error" && (f.code === "SECRET" || f.code === "SECRET-ALLOW"),
      );

    // No reason: the entry is an error of its own and the secret still fails.
    await writeFile(allowPath, `${DECISIONS}:${keyLine}:aws-key\n`);
    let errors = await secretErrors();
    assert.ok(
      errors.some((f) => f.code === "SECRET-ALLOW"),
      "the reasonless entry was accepted",
    );
    assert.ok(
      errors.some((f) => f.code === "SECRET"),
      "the reasonless entry spared the secret",
    );

    // Empty reason after the hash: the same.
    await writeFile(allowPath, `${DECISIONS}:${keyLine}:aws-key #   \n`);
    errors = await secretErrors();
    assert.ok(
      errors.some((f) => f.code === "SECRET"),
      "an empty reason spared the secret",
    );

    // Reasoned entry by location.
    await writeFile(
      allowPath,
      `${DECISIONS}:${keyLine}:aws-key # public documentation example, not a live key\n`,
    );
    assert.deepEqual(await secretErrors(), []);

    // Reasoned entry by fingerprint, which survives the line moving.
    const [finding] = scanText(await readFile(resolve(r.root, DECISIONS), "utf8"), DECISIONS);
    await writeFile(allowPath, `${finding.fingerprint} # same example, tracked by value\n`);
    assert.deepEqual(await secretErrors(), []);

    // The hook honours it too.
    await r.git("add", "-A");
    await r.git("commit", "-q", "-m", "allowed example");
    assert.match((await r.git("log", "--oneline")).stdout, /allowed example/);
  });
});

// ---------------------------------------------------------------------------
// Evasion attempts: caught.
// ---------------------------------------------------------------------------
describe("Quench evasion: caught", () => {
  it("MCP append_decision: title, decision, details, source and fields", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const key = awsKey();
    const before = await readFile(resolve(root, DECISIONS), "utf8");
    for (const write of [
      () => appendDecision(handle, "Meridian", `Key ${key}`, "Fine."),
      () => appendDecision(handle, "Meridian", "Deploy", `Use ${key}.`),
      () => appendDecision(handle, "Meridian", "Deploy", "Fine.", `see ${key}`),
      () => appendDecision(handle, "Meridian", "Deploy", "Fine.", undefined, { source: key }),
      () =>
        appendDecision(handle, "Meridian", "Deploy", "Fine.", undefined, {
          fields: [`note:: ${key}`],
        }),
    ]) {
      await assert.rejects(write, (error: Error) => {
        assert.match(error.message, /aws-key/);
        assert.equal(error.message.includes(key), false);
        return true;
      });
    }
    assert.equal(await readFile(resolve(root, DECISIONS), "utf8"), before);
  });

  it("MCP append_rule: name, body, source", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const key = awsKey();
    const before = await readFile(resolve(root, RULES), "utf8");
    for (const write of [
      () => appendRule(handle, "Meridian", `Key ${key}`, "Fine."),
      () => appendRule(handle, "Meridian", "Keys", `Use ${key}.`),
      () => appendRule(handle, "Meridian", "Keys", "Fine.", { source: key }),
    ]) {
      await assert.rejects(write, /aws-key/);
    }
    assert.equal(await readFile(resolve(root, RULES), "utf8"), before);
  });

  it("MCP update_capsule: every writable section", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const key = awsKey();
    const before = await readFile(resolve(root, CAPSULE), "utf8");
    for (const section of [
      "Identity",
      "Current Scope",
      "Must Remember",
      "Do Not Assume",
    ] as const) {
      await assert.rejects(updateCapsule(handle, "Meridian", section, `Uses ${key}.`), /aws-key/);
    }
    assert.equal(await readFile(resolve(root, CAPSULE), "utf8"), before);
  });

  it("a secret already in a note does not block an unrelated MCP edit, but a second one does", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const old = awsKey();
    const path = resolve(root, RULES);
    await writeFile(path, `${await readFile(path, "utf8")}\nLegacy: ${old}\n`);
    assert.ok(await appendRule(handle, "Meridian", "Naming", "Use kebab-case."));
    await assert.rejects(appendRule(handle, "Meridian", "Keys", `Also ${awsKey()}.`), /aws-key/);
  });

  it("index keeps the file, worktree loses it: scan-staged and the hook still refuse", async () => {
    const r = await repo();
    const key = awsKey();
    await writeFile(resolve(r.root, "02_Projects", "Meridian", "Scratch.md"), `leak ${key}\n`);
    await r.git("add", "-A");
    await rm(resolve(r.root, "02_Projects", "Meridian", "Scratch.md"));

    const scan = await capture(() => scanStagedCommand({ cwd: r.root }));
    assert.equal(scan.result, 1);
    assert.match(scan.screen, /Scratch\.md:1 aws-key/);
    assert.equal(scan.screen.includes(key), false);

    // doctor looks at the worktree and sees nothing; the hook is what stands in the way.
    const report = await runDoctor(r.root, await readManifest(r.root));
    assert.equal(
      report.findings.some((f) => f.code === "SECRET" && f.level === "error"),
      false,
    );
    const before = await r.head();
    await assert.rejects(r.git("commit", "-q", "-m", "ghost"));
    assert.equal(await r.head(), before);
  });

  it("index holds the leak, worktree is cleaned afterwards: the staged content is what is scanned", async () => {
    const r = await repo();
    const path = resolve(r.root, DECISIONS);
    const clean = await readFile(path, "utf8");
    await writeFile(path, `${clean}\nleak ${awsKey()}\n`);
    await r.git("add", "-A");
    await writeFile(path, clean);
    const scan = await capture(() => scanStagedCommand({ cwd: r.root }));
    assert.equal(scan.result, 1);
  });

  it("keyword values that are encoded still match under a credential name", () => {
    const b64 = Buffer.from(randomBody(30)).toString("base64");
    assert.equal(hasSecret(`aws_secret_access_key: ${b64}`), true);
    assert.equal(hasSecret(`API_KEY: ${randomBody(20)}`), true);
    assert.equal(hasSecret(`password=${encodeURIComponent(`p@ss/w0rd${randomBody(12)}`)}`), true);
  });
});

// ---------------------------------------------------------------------------
// Evasion attempts: escaped. Each is a todo: the body states the behaviour we
// want, runs, and its failure does not fail the suite. Widening what counts as
// a secret is the detector owner's call (Harper); nothing here changes the detector.
// ---------------------------------------------------------------------------
describe("Quench evasion: escaped (todo)", () => {
  const key = awsKey();
  const half = Math.floor(key.length / 2);
  const variants: [string, string, string][] = [
    ["lower case", "lower-case", key.toLowerCase()],
    ["mixed case prefix", "mixed-case", `${["ak", "ia"].join("")}${key.slice(4)}`],
    ["split across two lines", "split-line", `${key.slice(0, half)}\n${key.slice(half)}`],
    [
      "split with a backslash continuation",
      "split-backslash",
      `${key.slice(0, half)}\\\n${key.slice(half)}`,
    ],
    [
      "split as a string concatenation",
      "split-concat",
      `"${key.slice(0, half)}" + "${key.slice(half)}"`,
    ],
    ["split by a space", "split-space", `${key.slice(0, half)} ${key.slice(half)}`],
    ["base64", "base64", Buffer.from(key).toString("base64")],
    ["base64url", "base64url", Buffer.from(key).toString("base64url")],
    ["hex", "hex", Buffer.from(key).toString("hex")],
    [
      "URL-encoded in full",
      "url-full",
      [...key].map((c) => `%${c.charCodeAt(0).toString(16)}`).join(""),
    ],
    [
      "URL-encoded in one character",
      "url-one",
      `${key.slice(0, 4)}%${key.charCodeAt(4).toString(16)}${key.slice(5)}`,
    ],
    [
      "full-width letters",
      "fullwidth",
      [...key].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join(""),
    ],
    ["Cyrillic A in the prefix", "cyrillic", `\u0410${key.slice(1)}`],
    ["zero-width space inside", "zero-width", `${key.slice(0, half)}\u200B${key.slice(half)}`],
    ["soft hyphen inside", "soft-hyphen", `${key.slice(0, half)}\u00AD${key.slice(half)}`],
    ["reversed", "reversed", [...key].reverse().join("")],
  ];

  for (const [label, , text] of variants) {
    it(`detector: ${label}`, { todo: "not in scope of known patterns; Harper decides" }, () => {
      assert.equal(hasSecret(`note: ${text}`), true);
    });
  }

  it(
    "keyword value split over two lines",
    { todo: "value rule reads one line; Harper decides" },
    () => {
      assert.equal(hasSecret(`api_key: ${randomBody(10)}\n  ${randomBody(20)}`), true);
    },
  );

  for (const [label, , text] of [variants[2], variants[6]]) {
    it(
      `MCP append_rule writes a key that is ${label}`,
      { todo: "follows the detector" },
      async () => {
        const root = await scaffold();
        await assert.rejects(appendRule(await openVault(root), "Meridian", "Keys", `Use ${text}.`));
      },
    );
    it(
      `MCP update_capsule writes a key that is ${label}`,
      { todo: "follows the detector" },
      async () => {
        const root = await scaffold();
        await assert.rejects(
          updateCapsule(await openVault(root), "Meridian", "Identity", `Uses ${text}.`),
        );
      },
    );
  }

  it(
    "a key hidden behind a NUL byte reaches the commit",
    { todo: "scan-staged skips any blob with a NUL as binary" },
    async () => {
      const r = await repo();
      const before = await r.head();
      await writeFile(
        resolve(r.root, "02_Projects", "Meridian", "Nul.md"),
        `\0\nleak ${awsKey()}\n`,
      );
      await r.git("add", "-A");
      await assert.rejects(r.git("commit", "-q", "-m", "nul"));
      assert.equal(await r.head(), before);
    },
  );

  it(
    "`vulcanus sync` commits a key written into a non-markdown file",
    { todo: "doctor scans .md only; sync runs git add -A" },
    async () => {
      const r = await repo();
      const before = await r.head();
      await writeFile(resolve(r.root, "deploy.txt"), `key ${awsKey()}\n`);
      // Without the hook, as on a machine where `hooks install` was never run.
      await rm(resolve(r.root, ".git", "hooks", "pre-commit"), { force: true });
      const code = await syncCommand({ cwd: r.root });
      assert.equal(code === 1 || (await r.head()) === before, true);
    },
  );
});
