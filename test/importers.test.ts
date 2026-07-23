import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { analyzeConversations } from "../src/importers/analyze.js";
import { chatgptAdapter } from "../src/importers/chatgpt.js";
import { claudeExportAdapter } from "../src/importers/claude-export.js";
import { isStopword } from "../src/importers/stopwords.js";
import type { NormalizedConversation } from "../src/importers/types.js";
import { cleanup, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

function conversation(
  id: string,
  title: string,
  overrides: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "chatgpt",
    messages: [{ role: "user", text: title }],
    ...overrides,
  };
}

function stream(conversations: NormalizedConversation[]) {
  return () =>
    (async function* () {
      for (const item of conversations) yield item;
    })();
}

describe("candidate analysis", () => {
  it("promotes names that appear in conversation titles", async () => {
    const result = await analyzeConversations(
      stream([
        conversation("1", "Lumen menü tasarımı"),
        conversation("2", "Lumen cup direction"),
        conversation("3", "Lumen freeze-dry plan"),
        conversation("4", "unrelated chatter"),
      ]),
    );

    const names = result.candidates.map((candidate) => candidate.name);
    assert.ok(names.includes("Lumen"));
    assert.equal(result.conversations, 4);
  });

  it("merges Turkish dotted and dotless casing into one candidate", async () => {
    const result = await analyzeConversations(
      stream([
        conversation("1", "ARIA vault yapısı"),
        conversation("2", "Aria recall map"),
        conversation("3", "ARIA capsule"),
      ]),
    );

    const matches = result.candidates.filter(
      (candidate) => candidate.name.toLowerCase().replace("ı", "i") === "aria",
    );
    assert.equal(matches.length, 1, JSON.stringify(result.candidates));
    assert.equal(matches[0].evidence.titleHits, 3);
  });

  it("prefers the casing the source itself grouped under", async () => {
    const result = await analyzeConversations(
      stream([
        conversation("1", "Aria notes", { group: "ARIA", source: "claude-code" }),
        conversation("2", "Aria notes again"),
      ]),
    );

    const candidate = result.candidates.find((entry) => entry.name === "ARIA");
    assert.ok(candidate, JSON.stringify(result.candidates));
    assert.equal(candidate.evidence.explicitGroup, true);
    assert.equal(candidate.confidence, "high");
  });

  it("does not propose generic vocabulary that only appears in message bodies", async () => {
    const conversations = Array.from({ length: 30 }, (_, index) =>
      conversation(`c${index}`, `Lumen topic ${index}`, {
        messages: [{ role: "user", text: "return null from the function and get the value" }],
      }),
    );

    const result = await analyzeConversations(stream(conversations));
    const names = result.candidates.map((candidate) => candidate.name.toLowerCase());

    assert.ok(!names.includes("return"));
    assert.ok(!names.includes("function"));
  });
});

describe("stopwords", () => {
  it("matches punctuation and Turkish suffix variants", () => {
    assert.equal(isStopword("Next.js"), true);
    assert.equal(isStopword("Tasarımı"), true);
    assert.equal(isStopword("Lumen"), false);
  });
});

describe("chatgpt adapter", () => {
  it("reads split conversation batches and maps message parts", async () => {
    const dir = await tempDir();
    tempDirs.push(dir);

    await writeFile(
      resolve(dir, "conversations-000.json"),
      JSON.stringify([
        {
          id: "abc",
          title: "Lumen plan",
          create_time: 1_700_000_000,
          update_time: 1_700_000_500,
          mapping: {
            n1: { message: { author: { role: "user" }, content: { parts: ["hello Lumen"] } } },
            n2: { message: { author: { role: "assistant" }, content: { parts: ["sure"] } } },
            n3: { message: { author: { role: "system" }, content: { parts: ["ignored"] } } },
          },
        },
      ]),
      "utf8",
    );

    const inspected = await chatgptAdapter.inspect(dir);
    assert.equal(inspected?.source, "chatgpt");

    const loaded: NormalizedConversation[] = [];
    for await (const item of chatgptAdapter.load(dir)) loaded.push(item);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].title, "Lumen plan");
    assert.deepEqual(
      loaded[0].messages.map((message) => message.role),
      ["user", "assistant"],
    );
  });

  it("skips a corrupt batch instead of aborting the import", async () => {
    const dir = await tempDir();
    tempDirs.push(dir);

    await writeFile(resolve(dir, "conversations-000.json"), "{not json", "utf8");
    await writeFile(
      resolve(dir, "conversations-001.json"),
      JSON.stringify([{ id: "ok", title: "Meridian site", mapping: {} }]),
      "utf8",
    );

    const loaded: NormalizedConversation[] = [];
    for await (const item of chatgptAdapter.load(dir)) loaded.push(item);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].title, "Meridian site");
  });
});

describe("claude export adapter", () => {
  it("attaches the project name as an explicit group", async () => {
    const dir = await tempDir();
    tempDirs.push(dir);
    await mkdir(dir, { recursive: true });

    await writeFile(
      resolve(dir, "projects.json"),
      JSON.stringify([{ uuid: "p1", name: "Harbor" }]),
      "utf8",
    );
    await writeFile(
      resolve(dir, "conversations.json"),
      JSON.stringify([
        {
          uuid: "c1",
          name: "cleanup rules",
          project_uuid: "p1",
          created_at: "2026-01-01T00:00:00Z",
          chat_messages: [
            { sender: "human", text: "how should leftovers be handled" },
            { sender: "assistant", content: [{ type: "text", text: "move to Trash" }] },
          ],
        },
      ]),
      "utf8",
    );

    const loaded: NormalizedConversation[] = [];
    for await (const item of claudeExportAdapter.load(dir)) loaded.push(item);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].group, "Harbor");
    assert.equal(loaded[0].messages.length, 2);
  });
});

describe("directory-derived candidates", () => {
  it("drops scratch folders named like sentences and generic directories", async () => {
    const result = await analyzeConversations(
      stream([
        conversation("1", "session one", { group: "just-circling-back-to-this" }),
        conversation("2", "session two", { group: "master" }),
        conversation("3", "session three", { group: "Lumen" }),
      ]),
    );

    const names = result.candidates.map((candidate) => candidate.name);
    assert.ok(!names.includes("just-circling-back-to-this"));
    assert.ok(!names.includes("master"));
    assert.ok(names.includes("Lumen"));
  });

  it("capitalizes lowercase directory names but leaves deliberate casing alone", async () => {
    const { prettifyDirName } = await import("../src/importers/dirname.js");
    assert.equal(prettifyDirName("meridian"), "Meridian");
    assert.equal(prettifyDirName("sitetools"), "Sitetools");
    assert.equal(prettifyDirName("API"), "API");
    assert.equal(prettifyDirName("WebApp"), "WebApp");
  });
});
