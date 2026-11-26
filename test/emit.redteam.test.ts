/**
 * Red team: attacks on the private filter of `vulcanus emit` (PR #58).
 *
 * Promise: with `includePrivate` off, no name or note of a project marked
 * `visibility: private` reaches AGENTS.md, CLAUDE.md, .cursor/rules/vulcanus.mdc or
 * .github/copilot-instructions.md. Each test writes a live section that names the
 * private project one way, runs `emit`, and fails when the name reaches a file.
 * A red test is a finding; nothing here is skipped or marked todo.
 * A canary rides on the line that names the project (at `@@`, or the last line when
 * there is no `@@`), so a line that survives the filter is visible even when the name
 * is disguised.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { emitCommand } from "../src/commands/emit.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { writeManifest } from "../src/manifest/io.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const ON = "2026-06-01";
const CANARY = "zq7canary";
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/vulcanus.mdc",
  ".github/copilot-instructions.md",
];

const NAME = "Project Falcon";
const ID = "falcon-7";
const TRIGGER = "orion-lab";
const DIR = "Codename Zephyr";
const CHILD = "Talon Engine";

async function setup(capsule: (safe: string) => string, rules?: string) {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const code = resolve(parent, "code");
  await mkdir(code, { recursive: true });
  const input = manifest({
    projects: [
      project("alpha", "Alpha", { root: code }),
      project(ID, NAME, {
        visibility: "private",
        triggers: [TRIGGER],
        dirName: DIR,
        root: resolve(parent, "falcon-repo"),
      }),
      project("talon", CHILD, { parent: ID, root: resolve(parent, "talon-repo") }),
    ],
  });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  const alpha = buildPlan(input).allProjects.find((plan) => plan.project.id === "alpha")!;
  const safe = ["## Must Remember", "", "- Entry point is `src/index.ts`.", ""].join("\n");
  const head = "---\ntype: capsule\n---\n# Alpha Capsule\n\n";
  await writeFile(resolve(vault, alpha.capsule.path), head + capsule(safe));
  await writeFile(
    resolve(vault, alpha.rules.path),
    rules ?? "---\ntype: rules\n---\n# Alpha Rules\n\n## Active Rules\n\n- Run `npm test`.\n",
  );
  return { vault, code };
}

/** Text of every agent file after `emit alpha`; a file that was not written reads as "". */
async function emitted(vault: string, code: string, project = "alpha", repo?: string) {
  const sink = () => true;
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = sink;
  process.stderr.write = sink;
  let exit: number;
  try {
    exit = await emitCommand(project, {
      cwd: vault,
      on: ON,
      yes: true,
      interactive: false,
      repo,
    });
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  const texts: string[] = [];
  for (const file of FILES) {
    try {
      texts.push(await readFile(resolve(repo ?? code, file), "utf8"));
    } catch {
      texts.push("");
    }
  }
  return { exit, texts };
}

/** What a reader sees when the markup is set aside: letters and digits, folded. */
const squash = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function assertNoLeak(texts: string[], extra: string[] = []) {
  for (const [index, text] of texts.entries()) {
    assert.ok(!text.includes(CANARY), `${FILES[index]} kept a line meant for the filter:\n${text}`);
    const flat = squash(text);
    for (const word of ["falcon", "falcon7", "zephyr", "orion", ...extra]) {
      assert.ok(!flat.includes(word), `${FILES[index]} names "${word}":\n${text}`);
    }
  }
}

/** One live Capsule section whose body is `lines`, the canary on the last one. */
async function attack(lines: string[], heading = "Notes") {
  const marked = lines.some((line) => line.includes("@@"));
  const body = marked
    ? lines.map((line) => line.replaceAll("@@", CANARY))
    : [...lines.slice(0, -1), `${lines[lines.length - 1]} ${CANARY}`];
  const { vault, code } = await setup(
    (safe) => `${safe}\n## ${heading}\n\n${body.join("\n")}\n\n## After\n\n- After the notes.\n`,
  );
  const { texts } = await emitted(vault, code);
  assert.ok(texts[0].includes("Must Remember"), "the public part is still written");
  assertNoLeak(texts);
}

const table = (title: string, cases: Record<string, string[]>) =>
  describe(title, () => {
    for (const [label, lines] of Object.entries(cases)) {
      it(label, () => attack(lines));
    }
  });

describe("emit private filter: forms the filter is meant to catch", () => {
  table("plain and cased", {
    "the name": [`- Shared with ${NAME} next quarter.`],
    "upper case": [`- Shared with ${NAME.toUpperCase()} next quarter.`],
    "mixed case": ["- Shared with pRoJeCt fAlCoN next quarter."],
    "the id": [`- Shared with ${ID} next quarter.`],
    "the id in capitals": [`- Shared with ${ID.toUpperCase()} next quarter.`],
  });

  table("wikilinks", {
    link: [`- See [[${NAME} Hub]].`],
    "alias hides the target": [`- See [[${NAME} Hub|the hub]].`],
    "alias carries the name": [`- See [[Alpha Hub|${NAME}]].`],
    "heading link": [`- See [[${NAME} Capsule#Must Remember]].`],
    embed: [`![[${NAME} Capsule]]`],
    "embed with heading and size": [`![[${NAME} Capsule#Must Remember|300]]`],
    "link by id": [`- See [[${ID}]].`],
  });

  table("markdown", {
    "inline link text": [`- See [${NAME}](https://example.com/a).`],
    "inline link url": [`- See [the lab](https://example.com/${ID}).`],
    "reference definition": ["- See [lab][1].", `[1]: https://example.com/${ID} "${NAME}"`],
    "image alt": [`![${NAME}](diagram.png)`],
    "html attribute": [`<a href="https://example.com" title="${NAME}">lab</a>`],
  });

  table("comments", {
    "name inside a comment": [`- Public line. <!-- ${NAME} @@ -->`, "- Another public line."],
    "comment splits the name": [`- Shared with Project<!-- x --> Falcon next quarter.`],
    "comment inside the name": [`- Shared with Proj<!-- x -->ect Falcon next quarter.`],
    "multi-line comment around the name": ["<!--", `${NAME} @@`, "-->", "- Public line."],
  });

  table("code fences", {
    fenced: ["```", `${NAME} @@`, "```"],
    "tilde fence": ["~~~", `${NAME} @@`, "~~~"],
    "name in the info string": [`\`\`\`${NAME} @@`, "x", "```"],
    "unbalanced fence": ["```", "- Public line.", `- ${NAME} @@`],
    "longer closing fence": ["```", `- ${NAME} @@`, "`````"],
    "nested fence lengths": ["````", "```", `- ${NAME} @@`, "```", "````"],
    "inline code": [`- Shared with \`${NAME}\` next quarter.`],
    "indented fence": ["   ```", `- ${NAME} @@`, "   ```"],
  });
});

describe("emit private filter: the same name through other doors", () => {
  it("in a section heading", async () => {
    await attack(["- Public line."], NAME);
  });

  it("in a heading with a wikilink alias", async () => {
    await attack(["- Public line."], `[[${NAME} Hub|Hub]]`);
  });

  it("in the Rules note", async () => {
    const { vault, code } = await setup(
      (safe) => safe,
      `---\ntype: rules\n---\n# Alpha Rules\n\n## Active Rules\n\n- Run \`npm test\`.\n- Never ship ${NAME} ${CANARY}\n`,
    );
    assertNoLeak((await emitted(vault, code)).texts);
  });

  it("in the Rules note, through a link alias", async () => {
    const { vault, code } = await setup(
      (safe) => safe,
      `---\ntype: rules\n---\n# Alpha Rules\n\n## Active Rules\n\n- Run \`npm test\`.\n- Never ship [[${NAME} Hub|that]]. ${CANARY}\n`,
    );
    assertNoLeak((await emitted(vault, code)).texts);
  });

  it("in frontmatter and the title above the first section", async () => {
    const { vault, code } = await setup((safe) => safe);
    const alpha = buildPlan(manifest({ projects: [project("alpha", "Alpha")] })).allProjects[0];
    await writeFile(
      resolve(vault, alpha.capsule.path),
      `---\ntype: capsule\nrelated: "[[${NAME} Hub]]"\n---\n# ${NAME} ${CANARY}\n\n${NAME} intro ${CANARY}\n\n## Must Remember\n\n- Entry point.\n`,
    );
    assertNoLeak((await emitted(vault, code)).texts);
  });

  it("in a lifecycle line of a live section", async () => {
    await attack([
      "- Public line.",
      `superseded-by:: [[${NAME} Capsule#Must Remember]]`.replace("superseded-by", "see-also"),
      `valid-until:: 2999-01-01 ${NAME}`,
    ]);
  });
});

describe("emit private filter: sections that should not be written at all", () => {
  const dead = (lines: string[]) =>
    setup((safe) => `${safe}\n## Retired\n\n${lines.join("\n")}\n`).then(async ({ vault, code }) =>
      assertNoLeak((await emitted(vault, code)).texts),
    );

  it("a superseded section that links to the private note", () =>
    dead([
      `- ${NAME} ${CANARY}`,
      `superseded-by:: [[${NAME} Capsule#Must Remember]]`,
      "superseded-on:: 2026-01-01",
    ]));

  it("an expired section", () => dead([`- ${NAME} ${CANARY}`, "valid-until:: 2026-01-01"]));

  it("a section that is superseded by a public one but quotes the private one", () =>
    dead([`- ${NAME} ${CANARY}`, "superseded-by:: [[Alpha Capsule#Must Remember]]"]));
});

describe("emit private filter: the name is not written in one piece", () => {
  table("spacing and separators", {
    "wrapped onto the next line": ["- Shared with Project", "Falcon next quarter."],
    "wrapped, indented continuation": ["- Shared with Project", "  Falcon next quarter."],
    "wrapped inside a block quote": ["> Shared with Project", "> Falcon next quarter."],
    "two spaces": ["- Shared with Project  Falcon next quarter."],
    tab: ["- Shared with Project\tFalcon next quarter."],
    "no-break space": ["- Shared with Project\u00a0Falcon next quarter."],
    "thin space": ["- Shared with Project\u2009Falcon next quarter."],
    hyphen: ["- Shared with Project-Falcon next quarter."],
    underscore: ["- Shared with Project_Falcon next quarter."],
    "no space": ["- Shared with ProjectFalcon next quarter."],
    "camel case": ["- Shared with projectFalcon next quarter."],
    "the id without its hyphen": ["- Shared with falcon 7 next quarter."],
    "the id with an underscore": ["- Shared with falcon_7 next quarter."],
    "line separator U+2028": ["- Shared with Project\u2028Falcon next quarter."],
    "carriage return alone": ["- Shared with Project\rFalcon next quarter."],
    "word order": ["- Shared with Falcon (the Project) next quarter."],
  });

  table("lookalike characters", {
    "Cyrillic letters": ["- Shared with \u0420roject F\u0430lcon next quarter."],
    "Cyrillic in the id": ["- Shared with f\u0430lcon-7 next quarter."],
    "full-width letters": ["- Shared with \uff30roject \uff26alcon next quarter."],
    "mathematical bold": ["- Shared with \u{1D40F}roject \u{1D405}alcon next quarter."],
    "zero width space inside": ["- Shared with Proj\u200bect Fal\u200bcon next quarter."],
    "zero width joiner inside": ["- Shared with Project Fal\u200dcon next quarter."],
    "soft hyphen inside": ["- Shared with Project Fal\u00adcon next quarter."],
    "combining mark inside": ["- Shared with Project Falco\u0301n next quarter."],
    "right-to-left override": ["- Shared with \u202enoclaF tcejorP\u202c next quarter."],
    "script small l": ["- Shared with Project Fa\u2113con next quarter."],
  });

  table("markup that reads as the name", {
    "emphasis on one word": ["- Shared with Project *Falcon* next quarter."],
    "strong on one word": ["- Shared with Project **Falcon** next quarter."],
    "emphasis inside a word": ["- Shared with Project Fal*co*n next quarter."],
    "backslash escape": ["- Shared with Project Fal\\con next quarter."],
    "decimal entity": ["- Shared with Project Fal&#99;on next quarter."],
    "hex entity": ["- Shared with Project &#x46;alcon next quarter."],
    "named entity for the space": ["- Shared with Project&nbsp;Falcon next quarter."],
    "percent encoding": ["- Shared with [lab](https://example.com/Project%20Falcon) next quarter."],
    "plus in a query": ["- Shared with [lab](https://example.com/?q=project+falcon) next quarter."],
    "html tag between the words": ["- Shared with Project<b> </b>Falcon next quarter."],
    "html tag inside a word": ["- Shared with Project Fal<span></span>con next quarter."],
    "code spans side by side": ["- Shared with `Project` `Falcon` next quarter."],
    "link per word": ["- Shared with [Project](a) [Falcon](b) next quarter."],
    "wikilink per word": ["- Shared with [[Project]] [[Falcon]] next quarter."],
    "wikilink with the name only in the target of a path": [
      `- Shared with [[02_Projects/${DIR}/${NAME} Hub|the lab]] next quarter.`,
    ],
    "alias pipe escaped in a table": [`| lab | [[${NAME} Hub\\|the hub]] |`],
  });
});

describe("emit private filter: other names that belong to the private project", () => {
  table("its trigger word and folder", {
    "recall trigger": [`- Ask about ${TRIGGER} next quarter.`],
    "folder name": [`- Notes are in ${DIR}.`],
    "folder path in a link": [`- See [[02_Projects/${DIR}/Roadmap|roadmap]].`],
    "folder path in markdown": [`- See [roadmap](02_Projects/${DIR.replace(" ", "%20")}/).`],
  });

  table("a child of the private project", {
    "child name": [`- Talk to the ${CHILD} team.`],
    "child link": [`- See [[${CHILD} Hub|the hub]].`],
  });

  it("emitting a child of a private project is refused or skipped, as for its parent", async () => {
    const { vault, code } = await setup((safe) => safe);
    const repo = resolve(code, "..", "talon-repo");
    await mkdir(repo, { recursive: true });
    const { exit, texts } = await emitted(vault, code, "talon", repo);
    assert.ok(
      exit !== EXIT.ok || texts.every((text) => text === ""),
      "the child of a private project was written to a repository",
    );
  });

  it("emit with no project name skips the private project and its child", async () => {
    const { vault, code } = await setup((safe) => safe);
    await mkdir(resolve(code, "..", "falcon-repo"), { recursive: true });
    await mkdir(resolve(code, "..", "talon-repo"), { recursive: true });
    const sink = () => true;
    const out = process.stdout.write.bind(process.stdout);
    process.stdout.write = sink;
    process.stderr.write = sink;
    try {
      await emitCommand(undefined, { cwd: vault, on: ON, yes: true, interactive: false });
    } finally {
      process.stdout.write = out;
    }
    for (const dir of ["falcon-repo", "talon-repo"]) {
      for (const file of FILES) {
        await assert.rejects(
          readFile(resolve(code, "..", dir, file), "utf8"),
          { code: "ENOENT" },
          `${dir}/${file} was written`,
        );
      }
    }
  });
});
