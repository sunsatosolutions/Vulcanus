import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { ALLOW_FILE, scanCommand } from "../src/commands/scan.js";
import { runDoctor } from "../src/doctor/index.js";
import { EXIT } from "../src/errors.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { setPromptDriver } from "../src/prompts.js";
import { scanText } from "../src/secrets/detector.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, scriptedPrompts, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const NOTE = "02_Projects/Alpha/Alpha Notes.md";

// Test tokens are built at run time so no secret-shaped literal sits in the source.
const rnd = (n: number, seed = "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC") => seed.repeat(8).slice(0, n);
const token = (seed?: string) => `${["gh", "p_"].join("")}${rnd(36, seed)}`;
const awsKey = () => `${["AK", "IA"].join("")}${"Q7XK2M4P9R3T5V8W".slice(0, 16)}`;

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

async function approve(vault: string, answer: boolean) {
  const restore = setPromptDriver(scriptedPrompts([answer]).driver);
  try {
    return await capture(() => scanCommand({ cwd: vault, fix: true, interactive: true }));
  } finally {
    restore();
  }
}

describe("vulcanus scan", () => {
  afterEach(() => setLogLevel("normal"));

  it("prints file:line kind fingerprint, never a value, and exits 1 on a match", async () => {
    const github = token();
    const aws = awsKey();
    const vault = await vaultWith(`ok\nkey ${github}\nid ${aws}\n`);
    const { result, output } = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(result, EXIT.failed);
    assert.match(
      output,
      new RegExp(`^${NOTE.replace(/\./g, "\\.")}:2 github-token [0-9a-f]{12}$`, "m"),
    );
    assert.match(output, /:3 aws-key [0-9a-f]{12}$/m);
    for (const value of [github, aws]) {
      assert.ok(!output.includes(value));
      assert.ok(!output.includes(value.slice(4, 20)), "a fragment leaked");
    }
  });

  it("exits 0 on a vault with no match", async () => {
    const vault = await vaultWith("# Notes\n\nid 123e4567-e89b-12d3-a456-426614174000\n");
    const { result } = await capture(() => scanCommand({ cwd: vault }));
    assert.equal(result, EXIT.ok);
  });

  it("--fix writes nothing without a terminal", async () => {
    const text = `a\nkey ${token()}\n`;
    const vault = await vaultWith(text);
    const { result } = await capture(() =>
      scanCommand({ cwd: vault, fix: true, interactive: false }),
    );
    assert.equal(result, EXIT.failed);
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), text);
  });

  it("--fix patches only the finding's line, shows no value, and keeps CRLF", async () => {
    const github = token();
    const text = `# Keep\r\n\r\nkey ${github}\r\nlast line without newline`;
    const vault = await vaultWith(text);

    let run = await approve(vault, false);
    assert.equal(run.result, EXIT.cancelled);
    assert.equal(await readFile(resolve(vault, NOTE), "utf8"), text);
    assert.ok(!run.output.includes(github));

    run = await approve(vault, true);
    assert.equal(run.result, EXIT.ok);
    assert.ok(!run.output.includes(github));
    assert.equal(
      await readFile(resolve(vault, NOTE), "utf8"),
      "# Keep\r\n\r\nkey [REDACTED:github-token]\r\nlast line without newline",
    );
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.ok);
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
    ];

    for (const [name, line, value] of cases) {
      it(`masks ${name} whole in the preview and the file`, async () => {
        assert.equal(scanText(line).length, 1);
        const vault = await vaultWith(`${line}\n`);
        const run = await approve(vault, true);
        assert.equal(run.result, EXIT.ok);
        const file = await readFile(resolve(vault, NOTE), "utf8");
        for (const piece of [...value.split(/[\s"'\\]+/).filter((x) => x.length >= 2), value]) {
          assert.ok(!run.output.includes(piece) && !file.includes(piece), piece);
        }
        assert.match(file, /\[REDACTED:cli-password\]/);
      });
    }

    it("keeps text after a closed value", async () => {
      const vault = await vaultWith(`password="ab${BS}"cd ef9" then note\n`);
      await approve(vault, true);
      assert.equal(
        await readFile(resolve(vault, NOTE), "utf8"),
        'password="[REDACTED:cli-password]" then note\n',
      );
    });
  });

  it("--fix does not overwrite a file that changed while waiting for approval", async () => {
    const line = `key ${token()}`;
    const vault = await vaultWith(`${line}\n`);
    const edited = `${line}\nuser note\n`;
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

  it("--allow needs a reason, stores a fingerprint, and doctor honours the same entry", async () => {
    const github = token();
    const vault = await vaultWith(`x\nkey ${github}\n`);
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.failed);

    const nothing = await capture(() =>
      scanCommand({ cwd: vault, allow: `${NOTE}:1`, reason: "r" }),
    );
    assert.equal(nothing.result, EXIT.usage);
    const noReason = await capture(() => scanCommand({ cwd: vault, allow: `${NOTE}:2` }));
    assert.equal(noReason.result, EXIT.usage);

    const allowed = await capture(() =>
      scanCommand({ cwd: vault, allow: `${NOTE}:2`, reason: "documented example" }),
    );
    assert.equal(allowed.result, EXIT.ok);
    const stored = await readFile(resolve(vault, ALLOW_FILE), "utf8");
    assert.match(stored, /^[0-9a-f]{12} # documented example \(github-token\)\n$/);
    assert.ok(!stored.includes(github));
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.ok);

    const report = await runDoctor(vault, await readManifest(vault));
    assert.equal(
      report.findings.some(
        (f) => f.code === "SECRET-ALLOW" || (f.code === "SECRET" && f.level === "error"),
      ),
      false,
    );

    // A different value on the same line is not covered by the old fingerprint.
    await writeFile(resolve(vault, NOTE), `x\nkey ${token("zY9xW7vU5tS3rQ1pN8mK6jH4gE2dB0aC")}\n`);
    assert.equal((await capture(() => scanCommand({ cwd: vault }))).result, EXIT.failed);
  });
});

describe("one detector", () => {
  it("scan, doctor and the library agree on the same note", async () => {
    const text = `key ${token()}\nid ${awsKey()}\n`;
    const vault = await vaultWith(text);
    const library = scanText(text, NOTE).map(
      (f) => `${f.file}:${f.line} ${f.kind} ${f.fingerprint}`,
    );
    const printed = (await capture(() => scanCommand({ cwd: vault }))).output
      .split("\n")
      .filter((line) => line.startsWith(NOTE));
    assert.deepEqual(printed, library);
    const report = await runDoctor(vault, await readManifest(vault));
    const doctor = report.findings
      .filter((f) => f.code === "SECRET" && f.level === "error")
      .map((f) => `${f.file}:${f.line} ${f.message}`);
    assert.deepEqual(doctor, library);
  });
});
