import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { applyExtracted, buildExtractPrompt, parseExtracted } from "../src/ai/extract.js";
import { importCommand } from "../src/commands/import.js";
import { runDoctor } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { messages } from "../src/i18n.js";
import { readSeen, rememberIds, seenIds } from "../src/importers/seen.js";
import type { NormalizedConversation } from "../src/importers/types.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { classify } from "../src/memory/cues.js";
import {
  compareWithVault,
  existingSections,
  hitsIn,
  MAX_CANDIDATES_PER_PROJECT,
  rankCandidates,
  sentencesOf,
  suggestTitle,
  type MemoryCandidate,
  type SentenceHit,
} from "../src/memory/extract.js";
import { findMemoryCandidates, projectOf, reviewCandidates } from "../src/memory/inbox.js";
import { appendDecision, openVault } from "../src/mcp/tools.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
before(() => setLogLevel("quiet"));
after(async () => {
  setLogLevel("normal");
  for (const dir of tempDirs) await cleanup(dir);
});

const INPUT = manifest({
  projects: [
    project("meridian", "Meridian"),
    project("kiln", "Kiln", { triggers: ["kiln", "fırın"] }),
  ],
});
const DECISIONS = "02_Projects/Meridian/Meridian Decisions.md";
const RULES = "02_Projects/Meridian/Meridian Rules.md";
// Local midday, so "a day ago" is 4 October on the local calendar in every time zone.
const NOW = new Date(2026, 9, 5, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

async function scaffold() {
  const root = await tempDir();
  tempDirs.push(root);
  await writeFiles(root, generateFiles(INPUT).files);
  await writeManifest(root, INPUT);
  return root;
}

function conversation(
  id: string,
  text: string,
  extra: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    id,
    title: "Untitled",
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    source: "claude-code",
    messages: [
      { role: "user", text },
      { role: "assistant", text: "We decided to rewrite everything in Rust, from now on." },
    ],
    ...extra,
  };
}

async function* stream(list: NormalizedConversation[]) {
  for (const entry of list) yield entry;
}

/** A driver that answers from scripted queues and records what it was asked. */
function scripted(answers: { select?: string[]; text?: string[]; confirm?: boolean[] }) {
  const asked: string[] = [];
  const driver: PromptDriver = {
    async text(request) {
      asked.push(`text:${request.message}`);
      const next = answers.text?.shift();
      return next === undefined ? (request.initialValue ?? "") : next;
    },
    async select(request) {
      asked.push(`select:${request.options.map((option) => option.value).join(",")}`);
      const next = answers.select?.shift();
      if (next === undefined) throw new Error(`unexpected select: ${request.message}`);
      return next;
    },
    async multiselect() {
      throw new Error("unexpected multiselect");
    },
    async confirm(request) {
      asked.push(`confirm:${request.message}`);
      return answers.confirm?.shift() ?? false;
    },
  };
  return { driver, asked };
}

const t = messages("en");

describe("cues", () => {
  it("recognizes decisions, rules, and corrections in every shipped language", () => {
    assert.deepEqual(classify("We decided to ship on Fridays only."), {
      kind: "decision",
      weight: 3,
      correction: false,
    });
    assert.equal(classify("From now on every release gets a changelog entry.")?.kind, "rule");
    assert.equal(classify("Fiyatlandırmada kullanım bazlı modelle gidiyoruz.")?.weight, 3);
    assert.equal(classify("Bundan sonra tüm notlar Türkçe yazılacak.")?.kind, "rule");
    assert.equal(classify("Wir haben entschieden, Postgres zu nehmen.")?.kind, "decision");
    assert.equal(classify("A partir de ahora usamos pnpm en todos los repos.")?.kind, "rule");
    assert.equal(classify("Actually, we're going with monthly billing.")?.correction, true);
    assert.equal(classify("Aslında karar verdik, aylık faturalama olacak.")?.correction, true);
    assert.equal(classify("The weather is nice today."), null);
    // A correction alone states nothing.
    assert.equal(classify("Actually that looks fine."), null);
  });

  it("does not mistake a word inside another word for a cue", () => {
    assert.equal(classify("Our neverland theme stays purple."), null);
  });
});

describe("sentence extraction", () => {
  it("drops code, questions, fragments, and walls of text", () => {
    const sentences = sentencesOf(
      [
        "We decided to use `pnpm` everywhere.",
        "```js\nconst x = () => { never(); }\n```",
        "Should we always lint first?",
        "Too short.",
        `Always ${"very ".repeat(45)}long.`,
        "From now on we write tests first.",
      ].join(" "),
    );
    assert.deepEqual(sentences, [
      "We decided to use pnpm everywhere.",
      "From now on we write tests first.",
    ]);
  });

  it("reads user messages only", () => {
    const hits = hitsIn(conversation("a", "Nothing to see here at all."), "Meridian");
    assert.deepEqual(hits, []);
  });
});

describe("ranking", () => {
  const hit = (id: string, text: string, weight: number, conversationId = id): SentenceHit => ({
    id,
    conversationId,
    source: "codex",
    project: "Meridian",
    kind: "decision",
    weight,
    correction: false,
    text,
    time: NOW - DAY,
  });

  it("merges restatements and rewards repetition", () => {
    const ranked = rankCandidates(
      [
        hit("a#1", "We decided to bill per active seat monthly.", 3),
        hit("b#1", "we decided to bill per active seat, monthly", 3),
        hit("c#1", "Never deploy on Fridays please.", 1),
      ],
      NOW,
    );
    assert.equal(ranked.length, 1, "a lone weight-1 sentence stays below the bar");
    assert.equal(ranked[0].conversations, 2);
    assert.deepEqual(ranked[0].sentenceIds, ["a#1", "b#1"]);
    assert.equal(ranked[0].score, 3 + 2 + 1);
  });

  it("lets a repeated weak rule through and caps each project", () => {
    const repeated = rankCandidates(
      [hit("a#1", "Never deploy on Fridays please.", 1), hit("b#1", "Never deploy on Fridays.", 1)],
      NOW,
    );
    assert.equal(repeated.length, 1);

    const many = rankCandidates(
      Array.from({ length: 40 }, (_, n) =>
        hit(`x${n}#1`, `We decided topic${n} uses approach${n} with variant${n}.`, 3),
      ),
      NOW,
    );
    assert.equal(many.length, MAX_CANDIDATES_PER_PROJECT);
  });

  it("drops what the vault knows and points revisions at the live section", () => {
    const sections = existingSections(
      DECISIONS,
      [
        "## Billing",
        "",
        "### Decision",
        "",
        "We bill a flat yearly price per active seat.",
        "",
        "## Hosting",
        "",
        "Meridian runs on a single VPS in Frankfurt.",
      ].join("\n"),
      "decision",
      () => true,
    );
    const candidate = (text: string, correction = false): MemoryCandidate => ({
      id: "c1",
      project: "Meridian",
      kind: "decision",
      text,
      correction,
      score: 5,
      conversations: 1,
      lastSeen: NOW,
      sources: ["codex"],
      sentenceIds: ["a#1"],
    });

    const out = compareWithVault(
      [
        candidate("Meridian runs on a single VPS in Frankfurt."),
        candidate("Actually we bill monthly per active seat now.", true),
        candidate("We decided the logo stays orange."),
      ],
      new Map([["Meridian", sections]]),
    );
    assert.equal(out.length, 2, "a restatement of a recorded decision is dropped");
    assert.equal(out[0].replaces?.heading, "Billing");
    assert.equal(out[1].replaces, undefined);
  });

  it("suggests a short, unique heading", () => {
    assert.equal(
      suggestTitle("we decided to bill per active seat every month from now on."),
      "We decided to bill per active seat",
    );
    assert.equal(
      suggestTitle("Ship on Fridays.", new Set(["ship on fridays"])),
      "Ship on Fridays (2)",
    );
  });
});

describe("ai extraction", () => {
  const base: MemoryCandidate[] = [
    {
      id: "c1",
      project: "Meridian",
      kind: "decision",
      text: "We decided to bill per seat.",
      correction: false,
      score: 6,
      conversations: 2,
      lastSeen: NOW,
      sources: ["codex"],
      sentenceIds: ["a#1"],
    },
    {
      id: "c2",
      project: "Meridian",
      kind: "decision",
      text: "lets go with per seat billing",
      correction: true,
      score: 4,
      conversations: 1,
      lastSeen: NOW - DAY,
      sources: ["claude"],
      sentenceIds: ["b#3"],
    },
    {
      id: "c3",
      project: "Kiln",
      kind: "rule",
      text: "Never ship without a changelog.",
      correction: false,
      score: 3,
      conversations: 1,
      lastSeen: null,
      sources: ["codex"],
      sentenceIds: ["c#1"],
    },
  ];

  it("sends only candidate sentences", () => {
    const prompt = buildExtractPrompt(
      base.map(({ id, project, kind, text }) => ({ id, project, kind, text })),
    );
    assert.match(prompt, /c1 \| Meridian \| decision \| We decided to bill per seat\./);
    assert.doesNotMatch(prompt, /a#1/);
  });

  it("keeps evidence, merges, and discards anything untraceable", () => {
    const entries = parseExtracted(
      'Sure!\n```json\n{"candidates":[' +
        '{"from":["c1","c2"],"kind":"decision","text":"Billing is per seat."},' +
        '{"from":["c9"],"kind":"rule","text":"Invented."},' +
        '{"from":[],"kind":"rule","text":"No source."},' +
        '{"from":["c1","c3"],"kind":"rule","text":"Cross-project."},' +
        '{"from":["c3"],"kind":"wish","text":"Bad kind."}' +
        "]}\n```",
    );
    assert.ok(entries);
    const out = applyExtracted(base, entries);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "Billing is per seat.");
    assert.deepEqual(out[0].sentenceIds, ["a#1", "b#3"]);
    assert.equal(out[0].conversations, 2);
    assert.equal(out[0].correction, true);
    assert.deepEqual(out[0].sources, ["codex", "claude"]);
    assert.equal(parseExtracted("no json here"), null);
  });
});

describe("memory inbox in a vault", () => {
  it("assigns conversations by source grouping, then by title, never by body", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    assert.equal(projectOf(handle, conversation("a", "", { group: "meridian" })), "Meridian");
    assert.equal(projectOf(handle, conversation("b", "", { title: "Fırın pricing" })), "Kiln");
    assert.equal(
      projectOf(handle, conversation("c", "Meridian", { title: "x", syntheticTitle: true })),
      undefined,
    );
  });

  it("finds candidates, then writes only what the operator accepts", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    await appendDecision(
      handle,
      "meridian",
      "Billing",
      "We bill each active seat a flat yearly price.",
    );

    const found = await findMemoryCandidates(
      handle,
      stream([
        conversation("a", "Actually we decided to bill monthly per active seat.", {
          group: "Meridian",
        }),
        conversation("b", "From now on every Meridian release ships with a changelog entry.", {
          group: "Meridian",
        }),
        conversation("c", "We decided the Kiln logo stays orange forever.", { group: "Kiln" }),
        conversation("d", "We decided to ignore this unrelated thing entirely."),
      ]),
      NOW,
    );
    assert.deepEqual(found.conversationIds, ["a", "b", "c", "d"]);
    assert.equal(found.candidates.length, 3);
    const billing = found.candidates.find((entry) => entry.text.includes("monthly"));
    assert.equal(billing?.replaces?.heading, "Billing");

    const ordered = [
      billing,
      found.candidates.find((entry) => entry.text.includes("changelog"))!,
      found.candidates.find((entry) => entry.project === "Kiln")!,
    ];
    const { driver, asked } = scripted({
      // replace → accept; rule → edit then accept as rule; Kiln → skip
      select: ["replace", "edit", "rule", "skip"],
      text: ["Monthly Seat Billing", "Every release ships with a changelog entry.", "  "],
    });
    const restore = setPromptDriver(driver);
    try {
      const outcome = await reviewCandidates(handle, ordered, "claude-code", t);
      assert.deepEqual(
        { accepted: outcome.accepted, skipped: outcome.skipped, stopped: outcome.stopped },
        { accepted: 2, skipped: 1, stopped: false },
      );
    } finally {
      restore();
    }
    // The replacement option is offered first when there is something to replace.
    assert.match(asked[0], /^select:replace,decision,rule,edit,skip,stop$/);

    const decisions = await readFile(resolve(root, DECISIONS), "utf8");
    assert.match(
      decisions,
      /## Billing\n\nsuperseded-by:: \[\[Meridian Decisions#Monthly Seat Billing\]\]\nsuperseded-on:: \d{4}-\d{2}-\d{2}\n/,
    );
    assert.match(
      decisions,
      /## Monthly Seat Billing\n\nsupersedes:: \[\[Meridian Decisions#Billing\]\]\nsource:: import · claude-code · 2026-10-04\n\n### Decision\n\nActually we decided to bill monthly per active seat\./,
    );
    const rules = await readFile(resolve(root, RULES), "utf8");
    assert.match(
      rules,
      /## Every release ships with a changelog entry Rule\n\nsource:: import · claude-code · 2026-10-04\n\nEvery release ships with a changelog entry\./,
    );
    assert.doesNotMatch(rules + decisions, /Kiln logo/);
    assert.doesNotMatch(rules + decisions, /Rust/, "assistant text never reaches the vault");

    const report = await runDoctor(root, INPUT);
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings));
  });

  it("stop keeps what was accepted and writes nothing more", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const found = await findMemoryCandidates(
      handle,
      stream([
        conversation("a", "We decided Meridian ships every Friday afternoon.", {
          group: "Meridian",
        }),
        conversation("b", "We decided Meridian keeps its blue accent color.", {
          group: "Meridian",
        }),
      ]),
      NOW,
    );
    const { driver } = scripted({ select: ["decision", "stop"] });
    const restore = setPromptDriver(driver);
    try {
      const outcome = await reviewCandidates(handle, found.candidates, "codex", t);
      assert.equal(outcome.accepted, 1);
      assert.equal(outcome.stopped, true);
    } finally {
      restore();
    }
  });
});

describe("import --memory-only", () => {
  it("reviews an export end to end and records the conversations as reviewed", async () => {
    const root = await scaffold();
    const notes = await tempDir();
    tempDirs.push(notes);
    await mkdir(join(notes, "Meridian"), { recursive: true });
    await writeFile(
      join(notes, "Meridian", "pricing.md"),
      "# Pricing call\n\nWe decided Meridian bills monthly per active seat.\n",
    );

    const { driver } = scripted({ select: ["decision"], text: [""] }); // blank keeps the suggestion
    const restore = setPromptDriver(driver);
    let code: number;
    try {
      code = await importCommand({
        cwd: root,
        source: "markdown",
        path: notes,
        memoryOnly: true,
      });
    } finally {
      restore();
    }
    assert.equal(code, 0);
    assert.match(
      await readFile(resolve(root, DECISIONS), "utf8"),
      /## We decided Meridian bills monthly per active\n\nsource:: import · markdown · \d{4}-\d{2}-\d{2}\n\n### Decision\n\nWe decided Meridian bills monthly per active seat\./,
    );

    const vaultManifest = await readManifest(root);
    const ledger = await readSeen(root, vaultManifest);
    assert.equal(seenIds(ledger, "markdown", "memory").size, 1);
    assert.equal(seenIds(ledger, "markdown").size, 0, "project discovery still sees it as new");

    // A second run proposes nothing: the conversation was reviewed.
    const second = scripted({});
    const restoreAgain = setPromptDriver(second.driver);
    try {
      assert.equal(
        await importCommand({ cwd: root, source: "markdown", path: notes, memoryOnly: true }),
        0,
      );
    } finally {
      restoreAgain();
    }
    assert.deepEqual(second.asked, []);
  });

  it("keeps project and memory ledgers apart", () => {
    const empty = { version: 1 as const, sources: {} };
    const both = rememberIds(rememberIds(empty, "codex", ["a"]), "codex", ["b"], "memory");
    assert.deepEqual([...seenIds(both, "codex")], ["a"]);
    assert.deepEqual([...seenIds(both, "codex", "memory")], ["b"]);
  });
});
