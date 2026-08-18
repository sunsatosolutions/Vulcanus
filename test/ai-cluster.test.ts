import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_DIGEST_CONVERSATIONS,
  MAX_DIGEST_LINE,
  buildClusterPrompt,
  buildDigest,
  mergeClusters,
  parseClusters,
  runClustering,
} from "../src/ai/cluster.js";
import { AI_CLIS, type DetectedCli } from "../src/ai/clis.js";
import type { AnalysisResult } from "../src/importers/analyze.js";
import type { NormalizedConversation } from "../src/importers/types.js";

function conversation(
  id: string,
  title: string,
  extra: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    id,
    title,
    createdAt: null,
    updatedAt: null,
    source: "chatgpt",
    messages: [{ role: "user", text: `Opening line for ${title}` }],
    ...extra,
  };
}

function analysis(names: Array<[string, number]>): AnalysisResult {
  return {
    conversations: 10,
    sources: { chatgpt: 10 },
    candidates: names.map(([name, score]) => ({
      name,
      score,
      confidence: "low" as const,
      evidence: {
        conversations: score,
        titleHits: score,
        bodyHits: 0,
        explicitGroup: false,
        firstSeen: null,
        lastSeen: null,
        sampleTitles: [],
        sources: ["chatgpt"],
      },
    })),
  };
}

describe("what the model is shown", () => {
  test("carries titles and groups, never whole transcripts", () => {
    const digest = buildDigest([
      conversation("a", "Roastery site", {
        group: "Nué",
        messages: [
          { role: "user", text: "x".repeat(500) },
          { role: "assistant", text: "secret answer" },
        ],
      }),
    ]);

    assert.equal(digest[0].group, "Nué");
    assert.equal(digest[0].opening?.length, MAX_DIGEST_LINE);
    const prompt = buildClusterPrompt(digest);
    assert.equal(prompt.includes("secret answer"), false, "assistant replies are not sent");
  });

  test("drops a synthesized title rather than sending prompt boilerplate", () => {
    const digest = buildDigest([conversation("a", "run the tests", { syntheticTitle: true })]);
    assert.equal(digest[0].title, "");
  });

  test("caps how many conversations one prompt describes", () => {
    const many = Array.from({ length: MAX_DIGEST_CONVERSATIONS + 50 }, (_, index) =>
      conversation(`c${index}`, `Title ${index}`),
    );
    assert.equal(buildDigest(many).length, MAX_DIGEST_CONVERSATIONS);
  });
});

describe("reading the model's reply", () => {
  test("accepts a bare object", () => {
    const clusters = parseClusters('{"projects":[{"name":"Nué","conversationIds":["a","b"]}]}');
    assert.deepEqual(clusters, [{ name: "Nué", conversationIds: ["a", "b"] }]);
  });

  test("accepts JSON wrapped in prose or a fenced block", () => {
    const reply =
      'Here is the grouping:\n```json\n{"projects":[{"name":"Kiln","conversationIds":["a"]}]}\n```\nHope that helps.';
    assert.deepEqual(parseClusters(reply), [{ name: "Kiln", conversationIds: ["a"] }]);
  });

  test("skips entries without a usable name instead of inventing one", () => {
    const clusters = parseClusters(
      '{"projects":[{"name":"  "},{"name":"Kiln","conversationIds":["a",7]}]}',
    );
    assert.deepEqual(clusters, [{ name: "Kiln", conversationIds: ["a"] }]);
  });

  test("returns null when there is no JSON to read", () => {
    assert.equal(parseClusters("I could not determine any projects."), null);
    assert.equal(parseClusters('{"projects": "not a list"}'), null);
  });
});

describe("folding the grouping into the heuristic", () => {
  test("agreement promotes a candidate the heuristic already found", () => {
    const merged = mergeClusters(analysis([["Nué", 4]]), [
      { name: "nué", conversationIds: ["a", "b"] },
    ]);
    assert.equal(merged.candidates.length, 1);
    assert.equal(merged.candidates[0].confidence, "medium");
  });

  test("a name only the model proposed is added, but never as high confidence", () => {
    const merged = mergeClusters(analysis([["Nué", 4]]), [
      { name: "Tideline", conversationIds: ["a", "b", "c", "d"] },
    ]);
    const added = merged.candidates.find((candidate) => candidate.name === "Tideline");
    assert.equal(added?.confidence, "medium");
    assert.equal(added?.evidence.conversations, 4);
  });

  test("a cluster with no conversations behind it is not a candidate", () => {
    const merged = mergeClusters(analysis([]), [{ name: "Ghost", conversationIds: [] }]);
    assert.deepEqual(merged.candidates, []);
  });

  test("keeps the heuristic's evidence rather than the model's word for it", () => {
    const merged = mergeClusters(analysis([["Nué", 9]]), [
      { name: "Nué", conversationIds: ["only-one"] },
    ]);
    assert.equal(merged.candidates[0].evidence.conversations, 9);
  });
});

describe("running the CLI", () => {
  const cli: DetectedCli = { ...AI_CLIS[0], command: "claude", path: "/usr/bin/claude" };

  test("every CLI declares a headless form distinct from the interactive one", () => {
    for (const entry of AI_CLIS) {
      assert.notDeepEqual(
        entry.printArgs("p"),
        entry.args("p"),
        `${entry.id} would stay interactive`,
      );
    }
  });

  test("a crashing or hanging CLI leaves the import alone", async () => {
    const result = await runClustering(cli, buildDigest([conversation("a", "Kiln")]), (async () => {
      throw new Error("spawn ETIMEDOUT");
    }) as never);
    assert.equal(result.clusters, null);
    assert.match(result.error ?? "", /ETIMEDOUT/);
  });

  test("an empty history never spawns anything", async () => {
    let spawned = false;
    const result = await runClustering(cli, [], (async () => {
      spawned = true;
      return { stdout: "", stderr: "" };
    }) as never);
    assert.equal(spawned, false);
    assert.deepEqual(result.clusters, []);
  });
});
