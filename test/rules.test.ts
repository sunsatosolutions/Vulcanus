import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { buildProgram } from "../src/program.js";
import { rulesCheckCommand, rulesLinkCommand } from "../src/commands/rules.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { END, START, type RulesReport } from "../src/memory/rules.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const CAPSULE = "02_Projects/Alpha/Alpha Capsule.md";
const CAPSULE_TEXT = [
  "---",
  "type: capsule",
  "---",
  "# Alpha Capsule",
  "",
  "## Must Remember",
  "",
  "- Entry point is `src/index.ts`; see [[Alpha Hub|the hub]].",
  "- Build with `npm run build` before you commit.",
  "",
  "## Do Not Assume",
  "",
  "- Settings live in `config/app.json`.",
  "",
  "## Read Next",
  "",
  "- [[Alpha Hub]]",
  "",
].join("\n");

async function scaffold() {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const input = manifest({ projects: [project("alpha", "Alpha")] });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  await writeFile(resolve(vault, CAPSULE), CAPSULE_TEXT);

  const code = resolve(parent, "code");
  const files: Record<string, string> = {
    "src/index.ts": "export {};\n",
    "config/app.json": "{}\n",
    "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(resolve(code, path)), { recursive: true });
    await writeFile(resolve(code, path), text);
  }
  return { vault, code };
}

async function capture<T>(
  stream: "stdout" | "stderr",
  action: () => Promise<T>,
): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process[stream].write.bind(process[stream]);
  process[stream].write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    return { result: await action(), output: chunks.join("") };
  } finally {
    process[stream].write = original;
  }
}

async function link(vault: string, code: string, extra: { write?: boolean; dryRun?: boolean }) {
  setLogLevel("quiet");
  return capture("stderr", () => rulesLinkCommand("alpha", { cwd: vault, root: code, ...extra }));
}

async function check(code: string) {
  const { result, output } = await capture("stdout", () =>
    rulesCheckCommand({ root: code, json: true }),
  );
  return { code: result, report: JSON.parse(output) as RulesReport };
}

const read = (code: string, file: string) => readFile(resolve(code, file), "utf8");

describe("rules link", () => {
  it("is a dry run by default and writes nothing", async () => {
    const { vault, code } = await scaffold();
    const before = await readdir(code);
    for (const extra of [{}, { dryRun: true }]) {
      setLogLevel("normal");
      const { result, output } = await capture("stdout", () =>
        rulesLinkCommand("alpha", { cwd: vault, root: code, ...extra }),
      );
      assert.equal(result, EXIT.ok);
      assert.match(output, /\+ - Entry point is `src\/index\.ts`; see the hub\./);
      assert.match(output, /add --write/);
    }
    assert.deepEqual(await readdir(code), before);
    assert.equal((await link(vault, code, { write: true, dryRun: true })).result, EXIT.usage);
    assert.deepEqual(await readdir(code), before);
  });

  it("writes the three files, and a second run changes nothing", async () => {
    const { vault, code } = await scaffold();
    assert.equal((await link(vault, code, { write: true })).result, EXIT.ok);

    const files = ["AGENTS.md", "CLAUDE.md", ".cursor/rules/vault.mdc"];
    const first = await Promise.all(files.map((file) => read(code, file)));
    for (const text of first) {
      assert.ok(text.includes(`${START}\n## Alpha rules\n\n- Entry point`));
      assert.ok(text.includes(`- Settings live in \`config/app.json\`.\n${END}`));
      assert.ok(!text.includes("[["));
    }
    assert.match(
      first[2],
      /^---\ndescription: .+\nalwaysApply: true\n---\n\n<!-- vulcanus:rules:start/,
    );

    // Second run: no diff in a dry run, and the bytes stay put under --write.
    setLogLevel("normal");
    const dry = await capture("stdout", () =>
      rulesLinkCommand("alpha", { cwd: vault, root: code }),
    );
    assert.match(dry.output, /No difference\./);
    assert.equal((dry.output.match(/unchanged/g) ?? []).length, 3);
    assert.equal((await link(vault, code, { write: true })).result, EXIT.ok);
    assert.deepEqual(await Promise.all(files.map((file) => read(code, file))), first);
  });

  it("keeps the user's text outside the block, byte for byte", async () => {
    const { vault, code } = await scaffold();
    const above = "# Mine\r\n\r\nKeep  this \ttrailing   \r\n";
    const below = "\r\n\r\n## After\r\nlast line, no newline";
    const stale = `${START}\r\n## Alpha rules\r\n\r\n- old rule\r\n${END}`;
    await writeFile(resolve(code, "AGENTS.md"), above + stale + below);
    await writeFile(resolve(code, "CLAUDE.md"), "no newline at end");

    assert.equal((await link(vault, code, { write: true })).result, EXIT.ok);

    const agents = await read(code, "AGENTS.md");
    assert.ok(agents.startsWith(above + START));
    assert.ok(agents.endsWith(`${END}${below}`));
    assert.ok(agents.includes("\r\n- Build with `npm run build`"));
    assert.ok(!agents.includes("old rule"));
    const claude = await read(code, "CLAUDE.md");
    assert.ok(claude.startsWith("no newline at end\n\n" + START));
  });

  it("refuses a damaged block instead of guessing", async () => {
    const { vault, code } = await scaffold();
    const text = `my notes\n${START}\nhalf a block\n`;
    await writeFile(resolve(code, "AGENTS.md"), text);
    const { result, output } = await link(vault, code, { write: true });
    assert.equal(result, EXIT.usage);
    assert.match(output, /damaged/);
    assert.equal(await read(code, "AGENTS.md"), text);
    assert.deepEqual((await readdir(code)).sort(), ["AGENTS.md", "config", "package.json", "src"]);
  });
});

describe("rules check", () => {
  it("passes on fresh copies and pins the JSON shape", async () => {
    const { vault, code } = await scaffold();
    await link(vault, code, { write: true });
    const { code: exit, report } = await check(code);
    assert.equal(exit, EXIT.ok);
    assert.deepEqual(report, {
      root: code,
      ok: true,
      files: [
        { path: "AGENTS.md", state: "ok" },
        { path: "CLAUDE.md", state: "ok" },
        { path: ".cursor/rules/vault.mdc", state: "ok" },
      ],
      claimsChecked: 9,
      findings: [],
    });
  });

  it("catches a hand-edited copy, a deleted path, and a deleted script", async () => {
    const { vault, code } = await scaffold();
    await link(vault, code, { write: true });
    const claude = (await read(code, "CLAUDE.md")).replace(
      "Build with `npm run build` before you commit.",
      "Build whenever you like.",
    );
    await writeFile(resolve(code, "CLAUDE.md"), claude);
    await rm(resolve(code, "config"), { recursive: true });
    await writeFile(resolve(code, "package.json"), JSON.stringify({ scripts: {} }));

    const { code: exit, report } = await check(code);
    assert.equal(exit, EXIT.failed);
    assert.equal(report.ok, false);
    const key = (f: RulesReport["findings"][number]) => [f.kind, f.file, f.line, f.text];
    assert.deepEqual(report.findings.map(key), [
      ["divergent", "CLAUDE.md", 5, "- Build whenever you like."],
      ["script", "AGENTS.md", 5, "npm run build"],
      ["path", "AGENTS.md", 6, "config/app.json"],
      ["path", "CLAUDE.md", 6, "config/app.json"],
      ["script", ".cursor/rules/vault.mdc", 10, "npm run build"],
      ["path", ".cursor/rules/vault.mdc", 11, "config/app.json"],
    ]);
    assert.equal(
      report.findings.find((f) => f.kind === "divergent")?.reason,
      "differs from AGENTS.md: - Build with `npm run build` before you commit.",
    );
  });

  it("reports a missing file and refuses when nothing is linked", async () => {
    const { vault, code } = await scaffold();
    setLogLevel("quiet");
    assert.equal(
      (await capture("stderr", () => rulesCheckCommand({ root: code }))).result,
      EXIT.usage,
    );

    await link(vault, code, { write: true });
    await rm(resolve(code, "CLAUDE.md"));
    const { code: exit, report } = await check(code);
    assert.equal(exit, EXIT.failed);
    assert.deepEqual(
      report.findings.map((f) => [f.kind, f.file]),
      [["missing-block", "CLAUDE.md"]],
    );
    assert.equal(report.files[1].state, "missing-file");
  });
});

describe("rules help", () => {
  it("lists both subcommands", () => {
    const rules = buildProgram().commands.find((command) => command.name() === "rules")!;
    assert.deepEqual(
      rules.commands.map((command) => command.name()),
      ["link", "check"],
    );
    const help = rules.helpInformation();
    assert.match(help, /link\b.*Capsule rules/);
    assert.match(help, /check\b/);
  });
});
