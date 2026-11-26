import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { buildProgram } from "../src/program.js";
import { emitCommand, type EmitOptions } from "../src/commands/emit.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { setPromptDriver, type PromptDriver } from "../src/prompts.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const ON = "2026-06-01";
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/vulcanus.mdc",
  ".github/copilot-instructions.md",
];

const CAPSULE = [
  "---",
  "type: capsule",
  "---",
  "# Alpha Capsule",
  "",
  "## Must Remember",
  "",
  "- Entry point is `src/index.ts`; see [[Alpha Hub|the hub]].",
  "",
  "## Old Layout",
  "",
  "- Sources live in `lib/`.",
  "superseded-by:: [[Alpha Capsule#Must Remember]]",
  "superseded-on:: 2026-01-01",
  "",
  "## Freeze",
  "",
  "- Release freeze is on.",
  "valid-until:: 2026-03-01",
  "",
  "## Partners",
  "",
  "- Shared with Hidden Lab next quarter.",
  "- Public work stays in this repository.",
  "",
  "## Read Next",
  "",
  "- [[Alpha Hub]]",
  "",
].join("\n");

const RULES = [
  "---",
  "type: rules",
  "---",
  "# Alpha Rules",
  "",
  "## Active Rules",
  "",
  "- Run `npm test` before you commit.",
  "valid-until:: 2027-01-01",
  "",
].join("\n");

async function scaffold(extra: { visibility?: "private" } = {}) {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const code = resolve(parent, "code");
  await mkdir(code, { recursive: true });
  const input = manifest({
    projects: [
      project("alpha", "Alpha", { root: code, ...extra }),
      project("hidden", "Hidden Lab", { visibility: "private" }),
    ],
  });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  const alpha = buildPlan(input).allProjects[0];
  await writeFile(resolve(vault, alpha.capsule.path), CAPSULE);
  await writeFile(resolve(vault, alpha.rules.path), RULES);
  return { vault, code, capsule: resolve(vault, alpha.capsule.path) };
}

async function capture<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const sink = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  process.stdout.write = sink;
  process.stderr.write = sink;
  try {
    return { result: await action(), output: chunks.join("") };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

function answering(answer: boolean): { restore: () => void; asked: string[] } {
  const asked: string[] = [];
  const unused = async () => {
    throw new Error("unexpected prompt");
  };
  const driver: PromptDriver = {
    text: unused,
    select: unused,
    multiselect: unused,
    confirm: async (request) => {
      asked.push(request.message);
      return answer;
    },
  };
  return { restore: setPromptDriver(driver), asked };
}

async function emit(
  vault: string,
  options: EmitOptions = {},
  project: string | undefined = "alpha",
) {
  setLogLevel("normal");
  return capture(() =>
    emitCommand(project, { cwd: vault, on: ON, interactive: false, ...options }),
  );
}

/** First run: the operator says yes. */
async function approve(vault: string, options: EmitOptions = {}, name = "alpha") {
  const prompt = answering(true);
  try {
    return await emit(vault, { interactive: true, ...options }, name);
  } finally {
    prompt.restore();
  }
}

const read = (code: string, file: string) => readFile(resolve(code, file), "utf8");

describe("emit", () => {
  it("writes the four formats from one set of notes", async () => {
    const { vault, code } = await scaffold();
    assert.equal((await approve(vault)).result, EXIT.ok);

    const agents = await read(code, "AGENTS.md");
    assert.match(agents, /^<!-- vulcanus:begin -->\n<!-- Managed by `vulcanus emit`/);
    assert.ok(
      agents.includes(
        "## Alpha\n\n### Must Remember\n\n- Entry point is `src/index.ts`; see the hub.",
      ),
    );
    assert.ok(agents.includes("### Active Rules\n\n- Run `npm test` before you commit."));
    assert.ok(agents.endsWith("<!-- vulcanus:end -->\n"));
    assert.ok(!agents.includes("[["));
    assert.ok(!agents.includes("valid-until"));
    assert.ok(!agents.includes("Read Next"));

    const claude = await read(code, "CLAUDE.md");
    assert.match(
      claude,
      /<!-- vulcanus:begin -->\n<!--.*-->\n@AGENTS\.md\n<!-- vulcanus:end -->\n$/,
    );
    assert.ok(!claude.includes("Must Remember"));

    const cursor = await read(code, ".cursor/rules/vulcanus.mdc");
    assert.match(
      cursor,
      /^---\ndescription: .+\nalwaysApply: true\n---\n\n<!-- vulcanus:begin -->/,
    );
    assert.ok(cursor.includes("### Must Remember"));

    const copilot = await read(code, ".github/copilot-instructions.md");
    assert.equal(copilot, agents);
  });

  it("keeps everything outside the block, byte for byte, and updates without asking", async () => {
    const { vault, code } = await scaffold();
    const above = "# Mine\r\n\r\nKeep  this \ttrailing   \r\n";
    const below = "\r\n\r\n## After\r\nlast line, no newline";
    for (const file of FILES) {
      await mkdir(dirname(resolve(code, file)), { recursive: true });
      await writeFile(
        resolve(code, file),
        `${above}<!-- vulcanus:begin -->\r\nold\r\n<!-- vulcanus:end -->${below}`,
      );
    }
    const { result } = await emit(vault);
    assert.equal(result, EXIT.ok);
    for (const file of FILES) {
      const text = await read(code, file);
      assert.ok(text.startsWith(`${above}<!-- vulcanus:begin -->\r\n`));
      assert.ok(text.endsWith(`<!-- vulcanus:end -->${below}`));
      assert.ok(!text.includes("old"));
      assert.ok(!/[^\r]\n/.test(text.slice(above.length, text.length - below.length)));
    }
  });

  it("writes nothing into a file without markers unless a person approves", async () => {
    const { vault, code } = await scaffold();
    const mine = "# My rules\n\nBe kind.\n";
    await writeFile(resolve(code, "AGENTS.md"), mine);
    const before = await readdir(code);

    // No terminal: refuses, writes nothing, exit 1.
    const blind = await emit(vault);
    assert.equal(blind.result, EXIT.failed);
    assert.match(blind.output, /no terminal/);
    assert.deepEqual(await readdir(code), before);
    assert.equal(await read(code, "AGENTS.md"), mine);

    // A terminal and a no: still nothing.
    const no = answering(false);
    try {
      assert.equal((await emit(vault, { interactive: true })).result, EXIT.cancelled);
      assert.equal(no.asked.length, 1);
    } finally {
      no.restore();
    }
    assert.equal(await read(code, "AGENTS.md"), mine);
    assert.deepEqual(await readdir(code), before);

    // A yes appends after the operator's text and keeps it.
    assert.equal((await approve(vault)).result, EXIT.ok);
    const text = await read(code, "AGENTS.md");
    assert.ok(text.startsWith(`${mine}\n<!-- vulcanus:begin -->\n`));
  });

  it("dry-run shows the difference and writes nothing", async () => {
    const { vault, code } = await scaffold();
    const before = await readdir(code);
    const { result, output } = await emit(vault, { dryRun: true });
    assert.equal(result, EXIT.ok);
    assert.match(output, /AGENTS\.md: create/);
    assert.match(output, /\+ ### Must Remember/);
    assert.deepEqual(await readdir(code), before);
  });

  it("leaves out expired, superseded, and private content", async () => {
    const { vault, code } = await scaffold();
    await approve(vault);
    const text = await read(code, "AGENTS.md");
    assert.ok(!text.includes("Old Layout") && !text.includes("lib/"), "superseded");
    assert.ok(!text.includes("Freeze"), "expired");
    assert.ok(!text.includes("Hidden Lab"), "names a private project");
    assert.ok(text.includes("Public work stays in this repository."));

    // The same freeze counts again on a date before it expires.
    const early = await scaffold();
    await approve(early.vault, { on: "2026-02-01" });
    assert.ok((await read(early.code, "AGENTS.md")).includes("Release freeze is on."));
  });

  it("does not write a private project unless asked", async () => {
    const { vault, code } = await scaffold({ visibility: "private" });
    const before = await readdir(code);
    const refused = await emit(vault);
    assert.equal(refused.result, EXIT.usage);
    assert.match(refused.output, /marked private/);
    assert.equal((await emit(vault, {}, undefined)).result, EXIT.usage, "skipped when run for all");
    assert.deepEqual(await readdir(code), before);

    assert.equal((await approve(vault, { includePrivate: true })).result, EXIT.ok);
    assert.ok((await read(code, "AGENTS.md")).includes("### Must Remember"));
  });

  it("gives the same bytes for the same input", async () => {
    const { vault, code } = await scaffold();
    await approve(vault);
    const first = await Promise.all(FILES.map((file) => read(code, file)));
    const again = await emit(vault);
    assert.equal(again.result, EXIT.ok);
    assert.match(again.output, /No difference/);
    assert.deepEqual(await Promise.all(FILES.map((file) => read(code, file))), first);

    const other = await scaffold();
    await approve(other.vault);
    assert.deepEqual(await Promise.all(FILES.map((file) => read(other.code, file))), first);
  });

  it("--check exits 0 when current and non-zero once the vault changes", async () => {
    const { vault, code, capsule } = await scaffold();
    await approve(vault);
    const written = await Promise.all(FILES.map((file) => read(code, file)));

    const ok = await emit(vault, { check: true });
    assert.equal(ok.result, EXIT.ok);

    await writeFile(capsule, CAPSULE.replace("src/index.ts", "src/main.ts"));
    const stale = await emit(vault, { check: true });
    assert.equal(stale.result, EXIT.failed);
    // CLAUDE.md only imports AGENTS.md, so it stays current; the three copies are stale.
    for (const file of [FILES[0], FILES[2], FILES[3]])
      assert.match(stale.output, new RegExp(`${file.replace(/\./g, "\\.")}  stale`));
    assert.doesNotMatch(stale.output, /CLAUDE\.md/);
    assert.deepEqual(
      await Promise.all(FILES.map((file) => read(code, file))),
      written,
      "check wrote nothing",
    );

    await emit(vault); // updating existing blocks needs no yes
    assert.equal((await emit(vault, { check: true })).result, EXIT.ok);
  });

  it("--check reports a missing file and one without a block", async () => {
    const { vault, code } = await scaffold();
    await approve(vault);
    await writeFile(resolve(code, "CLAUDE.md"), "no block here\n");
    await writeFile(resolve(code, ".github/copilot-instructions.md"), "x");
    const { rm } = await import("node:fs/promises");
    await rm(resolve(code, ".cursor"), { recursive: true });
    const { result, output } = await emit(vault, { check: true });
    assert.equal(result, EXIT.failed);
    assert.match(output, /CLAUDE\.md {2}no vulcanus block/);
    assert.match(output, /vulcanus\.mdc {2}missing/);
    assert.match(output, /copilot-instructions\.md {2}no vulcanus block/);
  });

  it("refuses to write around damaged markers", async () => {
    const { vault, code } = await scaffold();
    const broken = "text\n<!-- vulcanus:begin -->\nhalf a block\n";
    await writeFile(resolve(code, "AGENTS.md"), broken);
    const { result, output } = await approve(vault);
    assert.equal(result, EXIT.failed);
    assert.match(output, /markers are damaged/);
    assert.equal(await read(code, "AGENTS.md"), broken);
    assert.deepEqual((await readdir(code)).sort(), ["AGENTS.md"]);
  });

  it("does not add a second import to a CLAUDE.md that already has one", async () => {
    const { vault, code } = await scaffold();
    const bridged = "<!-- vulcanus:bridge source=AGENTS.md -->\n@AGENTS.md\n";
    await writeFile(resolve(code, "CLAUDE.md"), bridged);
    await approve(vault);
    assert.equal(await read(code, "CLAUDE.md"), bridged);
  });

  it("takes the repository from --repo, and needs one", async () => {
    const parent = await tempDir();
    tempDirs.push(parent);
    const vault = resolve(parent, "vault");
    const input = manifest({ projects: [project("beta", "Beta")] });
    await writeFiles(vault, generateFiles(input).files);
    await writeManifest(vault, input);
    await writeFile(resolve(vault, buildPlan(input).allProjects[0].capsule.path), CAPSULE);
    const repo = resolve(parent, "elsewhere");
    await mkdir(repo);

    // No root in the manifest and no --repo: nothing to write into.
    assert.equal((await emit(vault, {}, "beta")).result, EXIT.usage);
    assert.equal((await emit(vault, {}, undefined)).result, EXIT.usage);
    // --repo names one folder, so it needs one project.
    assert.equal((await emit(vault, { repo }, undefined)).result, EXIT.usage);
    assert.equal((await emit(vault, { repo: resolve(parent, "nope") }, "beta")).result, EXIT.usage);

    assert.equal((await approve(vault, { repo }, "beta")).result, EXIT.ok);
    assert.ok((await read(repo, "AGENTS.md")).includes("## Beta"));
  });

  it("is registered as a command with --dry-run and --check", () => {
    const command = buildProgram().commands.find((entry) => entry.name() === "emit");
    assert.ok(command);
    const flags = command.options.map((option) => option.long);
    for (const flag of ["--repo", "--dry-run", "--check", "--include-private"]) {
      assert.ok(flags.includes(flag), flag);
    }
  });

  it("keeps a private project out of code blocks and wikilink aliases", async () => {
    const { vault, code, capsule } = await scaffold();
    await writeFile(
      capsule,
      CAPSULE.replace(
        "## Read Next",
        [
          "## Setup",
          "",
          "- Ask [[Hidden Lab|the lab]] first.",
          "- Public step.",
          "",
          "```sh",
          "deploy --to hidden-lab",
          "deploy --to hidden",
          "echo Hidden Lab",
          "echo public",
          "```",
          "",
          "## Read Next",
        ].join("\n"),
      ),
    );
    assert.equal((await approve(vault)).result, EXIT.ok);
    const agents = await read(code, "AGENTS.md");
    assert.ok(!agents.includes("the lab"));
    assert.ok(!agents.includes("Hidden Lab"));
    assert.ok(!agents.includes("deploy --to"));
    assert.ok(agents.includes("- Public step."));
    assert.ok(agents.includes("```sh\necho public\n```"));
  });

  it("removes the managed block when nothing current is left, and keeps the rest", async () => {
    const { vault, code, capsule } = await scaffold();
    const mine = "# Mine\n\nKeep this.\n";
    await writeFile(resolve(code, "AGENTS.md"), mine);
    assert.equal((await approve(vault)).result, EXIT.ok);
    assert.ok((await read(code, "AGENTS.md")).includes("### Must Remember"));

    const expired =
      "---\ntype: capsule\n---\n# Alpha Capsule\n\n## Old\n\n- Old.\nvalid-until:: 2026-01-01\n";
    await writeFile(capsule, expired);
    await writeFile(
      resolve(vault, buildPlan(await readManifest(vault)).allProjects[0].rules.path),
      "---\ntype: rules\n---\n# Alpha Rules\n",
    );
    const check = await emit(vault, { check: true });
    assert.equal(check.result, EXIT.failed);
    assert.equal((await emit(vault)).result, EXIT.ok);
    assert.equal(await read(code, "AGENTS.md"), mine);
    for (const file of FILES.filter((file) => file !== "AGENTS.md")) {
      const text = await read(code, file);
      assert.ok(!text.includes("vulcanus:begin"), file);
    }
    assert.equal((await emit(vault)).result, EXIT.ok, "nothing left to clean");
    assert.equal((await emit(vault, { check: true })).result, EXIT.ok, "clean is current");
  });

  it("removal keeps blank lines the person wrote around the block, byte for byte", async () => {
    const { vault, code, capsule } = await scaffold();
    assert.equal((await approve(vault)).result, EXIT.ok);
    const block = (await read(code, "AGENTS.md")).trimEnd();
    const mine = "# Mine\n\n\n\nKeep this.\n\n\n";
    await writeFile(resolve(code, "AGENTS.md"), `${mine}${block}\n`);
    await writeFile(capsule, "---\ntype: capsule\n---\n# Alpha Capsule\n");
    await writeFile(
      resolve(vault, buildPlan(await readManifest(vault)).allProjects[0].rules.path),
      "---\ntype: rules\n---\n# Alpha Rules\n",
    );
    assert.equal((await emit(vault)).result, EXIT.ok);
    assert.equal(await read(code, "AGENTS.md"), mine.slice(0, -1));
  });

  it("an empty project does not stop a batch emit", async () => {
    const { vault, code } = await scaffold();
    const m = await readManifest(vault);
    const other = resolve(code, "..", "other");
    await mkdir(other, { recursive: true });
    await writeManifest(vault, {
      ...m,
      projects: [...m.projects, project("beta", "Beta", { root: other })],
    });
    const run = await emit(vault, { check: true }, undefined);
    assert.notEqual(run.result, EXIT.usage);
    assert.match(run.output, /AGENTS\.md/);
  });
});
