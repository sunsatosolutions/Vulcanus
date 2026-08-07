import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { analyzeConversations } from "../src/importers/analyze.js";
import { chatgptAdapter } from "../src/importers/chatgpt.js";
import { claudeCodeAdapter } from "../src/importers/claude-code.js";
import { codexAdapter } from "../src/importers/codex.js";
import { cursorAdapter } from "../src/importers/cursor.js";
import { geminiAdapter } from "../src/importers/gemini.js";
import { ADAPTERS } from "../src/importers/index.js";
import { markdownAdapter } from "../src/importers/markdown.js";
import { rememberIds, seenIds, skipSeen } from "../src/importers/seen.js";
import type { NormalizedConversation } from "../src/importers/types.js";
import { cleanup, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

async function workspace(): Promise<string> {
  const dir = await tempDir();
  tempDirs.push(dir);
  return dir;
}

async function collect(
  iterable: AsyncIterable<NormalizedConversation>,
): Promise<NormalizedConversation[]> {
  const out: NormalizedConversation[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("importer robustness", () => {
  it("every adapter reports nothing for a directory it does not own", async () => {
    const dir = await workspace();
    await writeFile(resolve(dir, "notes.txt"), "hello", "utf8");

    for (const adapter of ADAPTERS) {
      // The markdown adapter is the one source that legitimately matches a
      // plain directory — that is its whole purpose.
      if (adapter.id === "markdown") continue;
      assert.equal(await adapter.inspect(dir), null, `${adapter.id} must not claim this directory`);
    }
  });

  it("survives an empty ChatGPT export", async () => {
    const dir = await workspace();
    await writeFile(resolve(dir, "conversations.json"), "[]", "utf8");

    const detected = await chatgptAdapter.inspect(dir);
    assert.equal(detected?.source, "chatgpt");
    assert.deepEqual(await collect(chatgptAdapter.load(dir)), []);
  });

  it("skips a corrupt ChatGPT batch and keeps the readable one", async () => {
    const dir = await workspace();
    await writeFile(resolve(dir, "conversations-000.json"), "{ this is not json", "utf8");
    await writeFile(
      resolve(dir, "conversations-001.json"),
      JSON.stringify([
        {
          id: "c1",
          title: "Meridian rollout",
          mapping: {
            a: { message: { author: { role: "user" }, content: { parts: ["ship it"] } } },
          },
        },
      ]),
      "utf8",
    );

    const loaded = await collect(chatgptAdapter.load(dir));
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].title, "Meridian rollout");
  });

  it("keeps exotic unicode titles intact", async () => {
    const dir = await workspace();
    await writeFile(
      resolve(dir, "conversations.json"),
      JSON.stringify([
        {
          id: "c1",
          title: "Çığır 🌊 İstanbul — ürün planı",
          mapping: { a: { message: { author: { role: "user" }, content: { parts: ["x"] } } } },
        },
      ]),
      "utf8",
    );

    const loaded = await collect(chatgptAdapter.load(dir));
    assert.equal(loaded[0].title, "Çığır 🌊 İstanbul — ürün planı");
  });

  it("reads a truncated JSONL session up to the broken line", async () => {
    const dir = await workspace();
    const project = resolve(dir, "-Users-ada-meridian");
    await mkdir(project, { recursive: true });
    await writeFile(
      resolve(project, "session.jsonl"),
      [
        JSON.stringify({
          type: "user",
          cwd: "/Users/ada/meridian",
          message: { role: "user", content: "first" },
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: "second" },
        }),
        '{"type":"user","message":{"role":"user","content":"trunc', // never finished
      ].join("\n"),
      "utf8",
    );

    const loaded = await collect(claudeCodeAdapter.load(dir));
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].messages.length, 2);
    assert.equal(loaded[0].group, "Meridian");
  });

  it("takes the Codex project name from the session's working directory", async () => {
    const dir = await workspace();
    const sessions = resolve(dir, "sessions/2026/01/02");
    await mkdir(sessions, { recursive: true });
    await writeFile(
      resolve(sessions, "rollout.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-01-02T10:00:00Z",
          type: "session_meta",
          payload: { cwd: "/Users/ada/harbor" },
        }),
        JSON.stringify({
          timestamp: "2026-01-02T10:01:00Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "text", text: "hello" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const loaded = await collect(codexAdapter.load(dir));
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].group, "Harbor");
    assert.equal(loaded[0].syntheticTitle, true);
  });
});

describe("gemini importer", () => {
  it("treats a saved chat tag as a real title and a log as synthetic", async () => {
    const dir = await workspace();
    const session = resolve(dir, "tmp/abc123");
    await mkdir(session, { recursive: true });
    await writeFile(
      resolve(session, "logs.json"),
      JSON.stringify([
        { type: "user", timestamp: "2026-01-01T00:00:00Z", message: "plan the harbor rollout" },
      ]),
      "utf8",
    );
    await writeFile(
      resolve(session, "checkpoint-Harbor.json"),
      JSON.stringify([
        { role: "user", parts: [{ text: "harbor pricing" }] },
        { role: "model", parts: [{ text: "noted" }] },
      ]),
      "utf8",
    );

    const detected = await geminiAdapter.inspect(dir);
    assert.match(detected?.detail ?? "", /saved under a name/);

    const loaded = await collect(geminiAdapter.load(dir));
    assert.equal(loaded.length, 2);

    const saved = loaded.find((entry) => entry.title === "Harbor");
    assert.equal(saved?.syntheticTitle, false);
    assert.equal(saved?.messages.length, 2);

    const log = loaded.find((entry) => entry.syntheticTitle);
    assert.ok(log, "the rolling log must still be read");
  });

  it("ignores an unparsable session file", async () => {
    const dir = await workspace();
    const session = resolve(dir, "tmp/abc123");
    await mkdir(session, { recursive: true });
    await writeFile(resolve(session, "logs.json"), "{{{", "utf8");

    assert.deepEqual(await collect(geminiAdapter.load(dir)), []);
  });
});

describe("cursor importer", () => {
  it("finds nothing where there is no workspace storage", async () => {
    assert.equal(await cursorAdapter.inspect(await workspace()), null);
  });

  it("names the platform's workspace storage locations", () => {
    const paths = cursorAdapter.defaultPaths();
    assert.ok(paths.length > 0);
    assert.ok(paths.every((path) => path.includes("workspaceStorage")));
  });
});

describe("markdown folder importer", () => {
  it("proposes the folder as the project and the heading as the title", async () => {
    const dir = await workspace();
    await mkdir(resolve(dir, "Harbor"), { recursive: true });
    await writeFile(resolve(dir, "Harbor/pricing.md"), "# Harbor pricing\n\nnotes\n", "utf8");
    await writeFile(resolve(dir, "Harbor/launch.md"), "# Harbor launch\n\nmore\n", "utf8");

    const detected = await markdownAdapter.inspect(dir);
    assert.equal(detected?.source, "markdown");

    const loaded = await collect(markdownAdapter.load(dir));
    assert.equal(loaded.length, 2);
    assert.ok(loaded.every((entry) => entry.group === "Harbor"));
    assert.ok(loaded.some((entry) => entry.title === "Harbor pricing"));

    const analysis = await analyzeConversations(() => markdownAdapter.load(dir));
    assert.ok(analysis.candidates.some((candidate) => candidate.name === "Harbor"));
  });

  it("is never probed automatically", () => {
    assert.deepEqual(markdownAdapter.defaultPaths(), []);
  });

  it("skips directories that are never memory", async () => {
    const dir = await workspace();
    await mkdir(resolve(dir, "node_modules/pkg"), { recursive: true });
    await writeFile(resolve(dir, "node_modules/pkg/README.md"), "# dependency\n", "utf8");

    assert.equal(await markdownAdapter.inspect(dir), null);
  });
});

describe("incremental import", () => {
  const conversation = (id: string): NormalizedConversation => ({
    id,
    title: `Topic ${id}`,
    createdAt: null,
    updatedAt: null,
    source: "chatgpt",
    messages: [{ role: "user", text: id }],
  });

  const stream = (ids: string[]) => () =>
    (async function* () {
      for (const id of ids) yield conversation(id);
    })();

  it("skips conversations a previous import already read", async () => {
    const seen = new Set(["a", "b"]);
    const encountered = new Set<string>();
    const filtered = skipSeen(stream(["a", "b", "c"]), seen, encountered);

    const loaded = await collect(filtered());
    assert.deepEqual(
      loaded.map((entry) => entry.id),
      ["c"],
    );
    // Everything the source produced is recorded, including what was skipped,
    // so the ledger does not forget and re-propose it next time.
    assert.deepEqual([...encountered].sort(), ["a", "b", "c"]);
  });

  it("merges ids into the ledger without losing older ones", () => {
    const first = rememberIds({ version: 1, sources: {} }, "chatgpt", ["a", "b"]);
    const second = rememberIds(first, "chatgpt", ["b", "c"]);

    assert.deepEqual([...seenIds(second, "chatgpt")].sort(), ["a", "b", "c"]);
    assert.equal(seenIds(second, "codex").size, 0);
  });
});
