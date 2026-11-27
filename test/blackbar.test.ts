import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildVaultServer } from "../src/commands/serve.js";
import { installHooksCommand } from "../src/commands/hooks.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { messages } from "../src/i18n.js";
import type { NormalizedConversation } from "../src/importers/types.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { appendDecision, openVault } from "../src/mcp/tools.js";
import { findMemoryCandidates, reviewCandidates } from "../src/memory/inbox.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { scanText } from "../src/secrets/detector.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const exec = promisify(execFile);
const tempDirs: string[] = [];
before(() => setLogLevel("quiet"));
after(async () => {
  setLogLevel("normal");
  for (const dir of tempDirs) await cleanup(dir);
});

const rnd = (n: number) => "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC".repeat(8).slice(0, n);
const FAKE = `${["gh", "p_"].join("")}${rnd(36)}`;
const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const RULES = "02_Projects/Meridian/Meridian Rules.md";
const CAPSULE = "02_Projects/Meridian/Meridian Capsule.md";
const NOW = new Date(2026, 9, 5, 12).getTime();

async function vault() {
  const root = await tempDir();
  tempDirs.push(root);
  const input = manifest({
    projects: [project("meridian", "Meridian", { triggers: ["meridian"] })],
  });
  await writeFiles(root, generateFiles(input).files);
  await writeManifest(root, input);
  return root;
}

const read = (root: string, path: string) => readFile(resolve(root, path), "utf8");

async function* stream(text: string): AsyncGenerator<NormalizedConversation> {
  yield {
    id: "chat",
    title: "Untitled",
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    source: "claude-code",
    group: "Meridian",
    messages: [{ role: "user", text }],
  };
}

const accepting: PromptDriver = {
  text: async (request) => request.initialValue ?? "",
  select: async (request) =>
    request.options.some((o) => o.value === "decision") ? "decision" : "",
  multiselect: async () => {
    throw new Error("unexpected multiselect");
  },
  confirm: async () => false,
};

describe("import masks secrets", () => {
  it("writes an accepted candidate with the secret masked and flags the kind", async () => {
    const root = await vault();
    const handle = await openVault(root);
    const found = await findMemoryCandidates(
      handle,
      stream(`We decided to deploy with the token ${FAKE} from now on.`),
      NOW,
    );
    assert.equal(found.candidates.length, 1);

    setLogLevel("normal");
    const shown: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      shown.push(String(chunk));
      return true;
    };
    const restore = setPromptDriver(accepting);
    let outcome;
    try {
      outcome = await reviewCandidates(handle, found.candidates, "claude-code", messages("en"));
    } finally {
      restore();
      process.stdout.write = original;
      setLogLevel("quiet");
    }

    assert.equal(outcome.accepted, 1);
    const note = await read(root, DECISIONS);
    assert.match(note, /\[REDACTED:github-token\]/);
    assert.equal(note.includes(FAKE), false);
    const screen = shown.join("");
    assert.match(screen, /github-token/);
    assert.equal(screen.includes(FAKE), false, "the review printed the raw value");
  });

  it("spares a value allowed by fingerprint in .vulcanus-allow", async () => {
    const root = await vault();
    const [hit] = scanText(FAKE);
    await writeFile(resolve(root, ".vulcanus-allow"), `${hit.fingerprint} # test fixture\n`);
    const handle = await openVault(root);
    const found = await findMemoryCandidates(
      handle,
      stream(`We decided to deploy with the token ${FAKE} from now on.`),
      NOW,
    );
    const restore = setPromptDriver(accepting);
    try {
      await reviewCandidates(handle, found.candidates, "claude-code", messages("en"));
    } finally {
      restore();
    }
    assert.equal((await read(root, DECISIONS)).includes(FAKE), true);
  });
});

describe("MCP writes refuse secrets", () => {
  async function connect(root: string) {
    const server = buildVaultServer(root);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  }
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    return { error: result.isError === true, text: result.content.map((c) => c.text).join("") };
  };

  it("rejects append_decision, append_rule and update_capsule, writing nothing", async () => {
    const root = await vault();
    const before = await Promise.all([DECISIONS, RULES, CAPSULE].map((f) => read(root, f)));
    const { client, close } = await connect(root);
    try {
      const results = [
        await call(client, "append_decision", {
          project: "meridian",
          title: "Deploy",
          decision: `Deploy with ${FAKE}.`,
        }),
        await call(client, "append_rule", {
          project: "meridian",
          name: "Deploy",
          rule: `Use ${FAKE}.`,
        }),
        await call(client, "update_capsule", {
          project: "meridian",
          section: "Must Remember",
          body: `Token ${FAKE}`,
        }),
      ];
      for (const result of results) {
        assert.equal(result.error, true);
        assert.match(result.text, /github-token/);
        assert.match(result.text, /known secret pattern/);
        assert.equal(result.text.includes(FAKE), false, "the error echoed the value");
      }
    } finally {
      await close();
    }
    const after = await Promise.all([DECISIONS, RULES, CAPSULE].map((f) => read(root, f)));
    assert.deepEqual(after, before);
  });

  it("still writes clean content, and a value allowed in .vulcanus-allow", async () => {
    const root = await vault();
    const { client, close } = await connect(root);
    try {
      const clean = await call(client, "append_decision", {
        project: "meridian",
        title: "Clean",
        decision: "Use sqlite.",
      });
      assert.equal(clean.error, false);

      const [hit] = scanText(FAKE);
      await writeFile(resolve(root, ".vulcanus-allow"), `${hit.fingerprint} # test fixture\n`);
      const allowed = await call(client, "append_rule", {
        project: "meridian",
        name: "Fixture",
        rule: `The fixture is ${FAKE}.`,
      });
      assert.equal(allowed.error, false);
    } finally {
      await close();
    }
  });

  it("does not block an unrelated write because the note already holds a secret", async () => {
    const root = await vault();
    const handle = await openVault(root);
    await writeFile(resolve(root, DECISIONS), `${await read(root, DECISIONS)}\nold ${FAKE}\n`);
    assert.ok(await appendDecision(handle, "meridian", "Later", "Use sqlite."));
  });
});

describe("doctor SECRET", () => {
  it("counts the matches and suggests scan --fix", async () => {
    const root = await vault();
    await writeFile(resolve(root, CAPSULE), `${await read(root, CAPSULE)}\nkey ${FAKE}\n`);
    const report = await runDoctor(root, await readManifest(root));
    const info = report.findings.find((f) => f.code === "SECRET" && f.level === "info");
    assert.match(info!.message, /1 match/);
    assert.match(info!.message, /vulcanus scan --fix/);
    assert.equal(JSON.stringify(report).includes(FAKE), false);
  });
});

describe("pre-commit hook", () => {
  it("stops a commit with a staged secret and lets a clean one through", async () => {
    const root = await vault();
    const env = { ...process.env, GIT_CONFIG_COUNT: "0" };
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
    const bin = resolve(root, "..", `bin-${resolve(root).split("/").pop()}`);
    await exec("git", ["init", "--quiet"], { cwd: root, env });
    // The box injects core.hooksPath through the environment, pointing outside this repository.
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
    await writeFile(
      resolve(bin, "vulcanus"),
      `#!/bin/sh\n[ "$1" = doctor ] && exit 0\n[ "$1" = emit ] && exit 0\nexec "${process.execPath}" --import "${tsx}" "${resolve("src/cli.ts")}" "$@"\n`,
    );
    await chmod(resolve(bin, "vulcanus"), 0o755);

    await writeFile(resolve(root, "notes.md"), `token ${FAKE}\n`);
    await git("add", "notes.md");
    await assert.rejects(git("commit", "-q", "-m", "leak"), (error: { stderr: string }) => {
      assert.match(error.stderr, /notes\.md:1 github-token/);
      assert.equal(error.stderr.includes(FAKE), false, "the hook printed the value");
      return true;
    });

    // The working tree is clean of the key but the index still holds it: still refused.
    await writeFile(resolve(root, "notes.md"), "fine\n");
    await assert.rejects(git("commit", "-q", "-m", "leak"));

    await git("add", "notes.md");
    await git("commit", "-q", "-m", "clean");
    const log = (await git("log", "--oneline")).stdout;
    assert.match(log, /clean/);
    assert.doesNotMatch(log, /leak/);
  });
});
