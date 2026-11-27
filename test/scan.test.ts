import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { ALLOW_FILE, scanCommand } from "../src/commands/scan.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { setPromptDriver } from "../src/prompts.js";
import { detectLine } from "../src/secrets/detect.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, scriptedPrompts, tempDir } from "./helpers.js";
import { negatives, positives } from "./secret-fixtures.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const NOTE = "02_Projects/Alpha/Alpha Notes.md";

async function vaultWith(text: string): Promise<string> {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const input = manifest({ projects: [project("alpha", "Alpha")] });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);
  await mkdir(resolve(vault, "02_Projects/Alpha"), { recursive: true });
  await writeFile(resolve(vault, NOTE), text);
  return vault;
}

async function capture<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const streams = [process.stdout, process.stderr];
  const originals = streams.map((stream) => stream.write.bind(stream));
  for (const stream of streams) {
    stream.write = (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    };
  }
  try {
    return { result: await action(), output: chunks.join("") };
  } finally {
    streams.forEach((stream, i) => (stream.write = originals[i]));
  }
}

describe("secret detector", () => {
  it("catches at least 95% of the fixtures, with the right type and level", () => {
    const fixtures = positives();
    assert.ok(fixtures.length >= 30, `only ${fixtures.length} fixtures`);
    const missed = fixtures.filter(
      (fixture) =>
        !detectLine(fixture.line).some(
          (match) =>
            match.type === fixture.type &&
            match.level === fixture.level &&
            fixture.line.slice(match.start, match.end) === fixture.value,
        ),
    );
    const rate = (fixtures.length - missed.length) / fixtures.length;
    console.log(
      `catch rate ${(rate * 100).toFixed(1)}% (${fixtures.length - missed.length}/${fixtures.length})`,
    );
    assert.ok(rate >= 0.95, `catch rate ${rate}; missed: ${missed.map((m) => m.name).join(", ")}`);
  });

  it("raises nothing on the negative set", () => {
    const flagged = negatives().filter((line) => detectLine(line).length > 0);
    console.log(`false positives ${flagged.length}/${negatives().length}`);
    assert.deepEqual(flagged, []);
  });

  it("marks entropy as a warning and every named rule as an error", () => {
    for (const fixture of positives()) {
      assert.equal(fixture.level, fixture.type === "high_entropy" ? "warning" : "error");
    }
  });
});

describe("vulcanus scan", () => {
  afterEach(() => setLogLevel("normal"));

  it("prints file:line type, never a value, and exits 1 on an error finding", async () => {
    const fixtures = positives();
    const vault = await vaultWith(fixtures.map((fixture) => fixture.line).join("\n") + "\n");
    const { result, output } = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(result, EXIT.failed);
    assert.match(output, new RegExp(`${NOTE.replace(/\./g, "\\.")}:1 api_key`));
    for (const fixture of fixtures) {
      assert.ok(!output.includes(fixture.value), `${fixture.name} leaked`);
      // A fragment must not leak either.
      assert.ok(!output.includes(fixture.value.slice(4, 20)), `${fixture.name} leaked in part`);
    }
  });

  it("exits 0 and lists warnings when only the entropy rule fires", async () => {
    const warning = positives().find((fixture) => fixture.level === "warning")!;
    const vault = await vaultWith(`${warning.line}\n`);
    const { result, output } = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(result, EXIT.ok);
    assert.match(output, /warnings:\n.*:1 high_entropy/);
    assert.ok(!output.includes(warning.value));
  });

  it("exits 0 on the negative set", async () => {
    const vault = await vaultWith(negatives().join("\n") + "\n");
    const { result } = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(result, EXIT.ok);
  });

  it("--fix writes nothing without a terminal", async () => {
    const text = `a\n${positives()[0].line}\n`;
    const vault = await vaultWith(text);
    const { result } = await capture(() =>
      scanCommand({ cwd: vault, fix: true, interactive: false }),
    );
    assert.equal(result, EXIT.failed);
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), text);
  });

  it("--fix patches only the finding's line, shows no value, and keeps CRLF", async () => {
    const github = positives().find((fixture) => fixture.type === "github_token")!;
    const text = `# Keep\r\n\r\n${github.line}\r\nlast line without newline`;
    const vault = await vaultWith(text);

    const declined = scriptedPrompts([false]);
    let restore = setPromptDriver(declined.driver);
    let run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
    restore();
    assert.equal(run.result, EXIT.cancelled);
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), text);
    assert.ok(!run.output.includes(github.value));

    restore = setPromptDriver(scriptedPrompts([true]).driver);
    run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
    restore();
    assert.equal(run.result, EXIT.ok);
    assert.ok(!run.output.includes(github.value));
    const after = await readFile(resolve(vault, NOTE), "utf8");
    assert.equal(
      after,
      `# Keep\r\n\r\n${github.line.replace(github.value, "[REDACTED:github_token]")}\r\nlast line without newline`,
    );
    const again = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(again.result, EXIT.ok);
  });

  it("masks a whole quoted password that contains spaces", async () => {
    for (const line of ['password: "correct horse 9 battery"', "pwd = 'tr0ub4dor and 3 more'"]) {
      const value = line.slice(line.search(/["']/) + 1, -1);
      const found = detectLine(line);
      assert.equal(found.length, 1, line);
      assert.equal(line.slice(found[0].start, found[0].end), value);
    }
    const vault = await vaultWith('password: "correct horse 9 battery"\n');
    const restore = setPromptDriver(scriptedPrompts([true]).driver);
    const run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
    restore();
    assert.equal(run.result, EXIT.ok);
    assert.ok(!run.output.includes("horse"));
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), 'password: "[REDACTED:password]"\n');
  });

  it("masks a password that contains a token, whole, in the preview and the file", async () => {
    const token = `ghp_${"aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6"}`;
    const line = `password: "${token} and more words 9"`;
    const found = detectLine(line);
    assert.ok(found.some((m) => m.type === "password"));
    assert.ok(found.some((m) => m.type === "github_token"));
    const vault = await vaultWith(`${line}\n`);
    const restore = setPromptDriver(scriptedPrompts([true]).driver);
    const run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
    restore();
    assert.equal(run.result, EXIT.ok);
    assert.ok(!run.output.includes("more words"));
    assert.ok(!run.output.includes("ghp_"));
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), 'password: "[REDACTED:password]"\n');
  });

  describe("quoted password values", () => {
    const BS = "\\";
    const cases: [string, string, string][] = [
      ["escaped double quote", `password="ab${BS}"cd ef9"`, `ab${BS}"cd ef9`],
      ["escaped single quote", `pwd='ab${BS}'cd ef9'`, `ab${BS}'cd ef9`],
      [
        "consecutive escapes",
        `password="ab${BS}${BS}${BS}"cd ef9" tail`,
        `ab${BS}${BS}${BS}"cd ef9`,
      ],
      ["escaped backslash then close", `password="abc ef9${BS}${BS}" tail`, `abc ef9${BS}${BS}`],
      ["mixed quotes inside", `password="it's ${BS}"ab${BS}" 9x"`, `it's ${BS}"ab${BS}" 9x`],
      ["single quote holding a double", `password='say "hi" 9x'`, 'say "hi" 9x'],
      ["unclosed double quote", 'password="ab cd ef9 and the rest', "ab cd ef9 and the rest"],
      ["unclosed single quote", "passwd: 'ab cd ef9 more words", "ab cd ef9 more words"],
      ["unclosed after escape", `password="ab cd${BS}"ef 9 end`, `ab cd${BS}"ef 9 end`],
    ];

    async function fixed(line: string) {
      const vault = await vaultWith(`${line}\n`);
      const restore = setPromptDriver(scriptedPrompts([true]).driver);
      const run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
      restore();
      assert.equal(run.result, EXIT.ok);
      return { output: run.output, file: await readFile(resolve(vault, NOTE), "utf8") };
    }

    function assertGone(value: string, ...texts: string[]) {
      const pieces = [...value.split(/[\s"'\\]+/).filter((x) => x.length >= 2), value];
      for (const text of texts) for (const piece of pieces) assert.ok(!text.includes(piece), piece);
    }

    for (const [name, line, value] of cases) {
      it(`masks ${name} whole in the preview and the file`, async () => {
        const found = detectLine(line);
        assert.equal(found.length, 1);
        assert.equal(line.slice(found[0].start, found[0].end), value);
        const { output, file } = await fixed(line);
        assertGone(value, output, file);
        assert.match(file, /\[REDACTED:password\]/);
      });
    }

    it("keeps text after a closed value", async () => {
      const { file } = await fixed(`password="ab${BS}"cd ef9" then note`);
      assert.equal(file, 'password="[REDACTED:password]" then note\n');
    });

    it("masks a token inside a quoted password", async () => {
      const token = `ghp_${"aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6"}`;
      const line = `password="x${BS}"${token} y9"`;
      const { output, file } = await fixed(line);
      assertGone(token, output, file);
      assert.ok(!output.includes("y9") && !file.includes("y9"));
    });

    it("masks both passwords on one line", async () => {
      const line = `password="one${BS}"aa 9x" and pwd='two${BS}'bb 9y'`;
      const found = detectLine(line);
      assert.equal(found.length, 2);
      const { output, file } = await fixed(line);
      for (const piece of ["one", "aa", "9x", "two", "bb", "9y"]) {
        assert.ok(!output.includes(piece) && !file.includes(piece), piece);
      }
      assert.equal(file, "password=\"[REDACTED:password]\" and pwd='[REDACTED:password]'\n");
    });
  });

  it("--fix does not overwrite a file that changed while waiting for approval", async () => {
    const github = positives().find((fixture) => fixture.type === "github_token")!;
    const vault = await vaultWith(`${github.line}\n`);
    const edited = `${github.line}\nuser note\n`;
    const base = scriptedPrompts([]).driver;
    const restore = setPromptDriver({
      ...base,
      async confirm() {
        await writeFile(resolve(vault, NOTE), edited);
        return true;
      },
    });
    const run = await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
    restore();
    assert.equal(run.result, EXIT.failed);
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), edited);
  });

  it("--allow stores a hash, not the value, and scan then passes", async () => {
    const github = positives().find((fixture) => fixture.type === "github_token")!;
    const vault = await vaultWith(`x\n${github.line}\n`);
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.failed);

    const nothing = await capture(() => scanCommand({ cwd: vault, allow: `${NOTE}:1` }));
    assert.equal(nothing.result, EXIT.usage);

    const allowed = await capture(() => scanCommand({ cwd: vault, allow: `${NOTE}:2` }));
    assert.equal(allowed.result, EXIT.ok);
    const stored = await readFile(resolve(vault, ALLOW_FILE), "utf8");
    assert.match(stored, /^sha256:[0-9a-f]{64} github_token\n$/);
    assert.ok(!stored.includes(github.value));
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.ok);

    // A different value on the same line is not covered by the old hash.
    await writeFile(
      resolve(vault, NOTE),
      `x\n${positives().filter((f) => f.type === "github_token")[1].line}\n`,
    );
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.failed);
  });
});
