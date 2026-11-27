import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { doctorCommand } from "../src/commands/doctor.js";
import { runDoctor, type DoctorReport } from "../src/doctor/index.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { parseAllow } from "../src/secrets/allow.js";
import {
  hasSecret,
  maskSecrets,
  scanText,
  shannonEntropy,
  type SecretKind,
} from "../src/secrets/detector.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

after(() => setLogLevel("normal"));

// Token-shaped values are joined at run time so no token-looking text sits in the repo.
const rnd = (n: number) => "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC".repeat(8).slice(0, n);
const dashes = "-".repeat(5);

const POSITIVE: [SecretKind, string][] = [
  ["aws-key", `aws_id ${["AK", "IA"].join("")}${"7Q2".repeat(6).slice(0, 16)} here`],
  ["github-token", `use ${["gh", "p_"].join("")}${rnd(36)} now`],
  ["npm-token", `//registry:_authToken=${["npm", "_"].join("")}${rnd(36)}`],
  ["stripe-key", `${["sk", "live", ""].join("_")}${rnd(24)}`],
  ["slack-token", `${["xo", "xb"].join("")}-${"1234567890"}-${rnd(20)}`],
  ["google-api-key", `key ${["AI", "za"].join("")}${rnd(35)}`],
  ["llm-key", `${["sk", "ant", ""].join("-")}${rnd(40)}`],
  [
    "private-key",
    [
      `${dashes}BEGIN ${["OPENSSH", "PRIVATE", "KEY"].join(" ")}${dashes}`,
      rnd(40),
      `${dashes}END ${["OPENSSH", "PRIVATE", "KEY"].join(" ")}${dashes}`,
    ].join("\n"),
  ],
  ["db-url", `${["postgres", ""].join("://")}app_user:${rnd(14)}@db.internal:5432/app`],
  ["bearer-token", `Authorization: Bearer ${rnd(30)}`],
  ["cli-password", `tool --password ${rnd(14)} --verbose`],
  ["cli-password", `${["PGPASS", "WORD"].join("")}=${rnd(14)} psql`],
  ["cli-password", `${["MYSQL", "PWD"].join("_")}='${rnd(14)}'`],
  ["cli-password", `mysql -u root -p${rnd(12)} -h localhost`],
  ["generic-secret", `api_key: ${rnd(24)}`],
  ["generic-secret", `password = "${rnd(16)}"`],
];

const NEGATIVE: string[] = [
  "id: 550e8400-e29b-41d4-a716-446655440000",
  "token: 550e8400-e29b-41d4-a716-446655440000",
  "commit 9fceb02d0ae598e95dc970b74767f19372d61af7",
  "secret: 9fceb02d0ae598e95dc970b74767f19372d61af7",
  "sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "integrity: sha512-" + rnd(30),
  "A plain note about the secret garden and token economics.",
  "password: <your-password>",
  "export PGPASSWORD=$DB_PASSWORD",
  "tool --password-stdin < file",
  "mysql -u root -p -h localhost",
  "npm run dev -p 3000",
  "Authorization: Bearer <token>",
  "postgres://user:${DB_PASS}@host/db",
  "postgres://host:5432/db",
  "api_key: see [[Vault Keys]]",
  "token: https://example.com/path/with/some-long-segment-123",
  "secret: authentication-service-handler",
  `${dashes}BEGIN CERTIFICATE${dashes}`,
];

function kinds(text: string): SecretKind[] {
  return scanText(text, "n.md").map((finding) => finding.kind);
}

describe("secret detector: patterns", () => {
  for (const [kind, text] of POSITIVE) {
    it(`finds ${kind}`, () => {
      assert.deepEqual(kinds(text), [kind]);
      assert.equal(hasSecret(text), true);
    });
  }

  NEGATIVE.forEach((text, index) => {
    it(`ignores negative fixture ${index + 1}`, () => {
      assert.deepEqual(kinds(text), []);
    });
  });

  it("reports the line a multi-line key starts on", () => {
    const key = POSITIVE.find(([kind]) => kind === "private-key")![1];
    const [finding] = scanText(`one\ntwo\n${key}\nafter`, "n.md");
    assert.equal(finding.line, 3);
  });

  it("masks an unterminated key header", () => {
    assert.deepEqual(kinds(`${dashes}BEGIN PRIVATE KEY${dashes}\nabc`), ["private-key"]);
  });

  it("entropy threshold is tunable", () => {
    const text = `secret: ${"abcd1234".repeat(2)}`;
    assert.ok(shannonEntropy("abcd1234abcd1234") < 3.2);
    assert.deepEqual(kinds(text), []);
    assert.deepEqual(
      scanText(text, "n.md", { entropyThreshold: 2.5 }).map((finding) => finding.kind),
      ["generic-secret"],
    );
  });
});

describe("secret detector: no raw value leaves", () => {
  it("keeps every value out of findings and masked text", () => {
    const values = [
      `${["gh", "p_"].join("")}${rnd(36)}`,
      `${["AK", "IA"].join("")}${"7Q2".repeat(6).slice(0, 16)}`,
      rnd(24),
    ];
    const text = [
      `a ${values[0]}`,
      `b ${values[1]}`,
      `api_key: ${values[2]}`,
      POSITIVE.find(([kind]) => kind === "private-key")![1],
    ].join("\n");

    const findings = scanText(text, "n.md");
    const masked = maskSecrets(text, "n.md");
    const dump = JSON.stringify(findings) + masked.text + JSON.stringify(masked.findings);
    for (const value of [...values, rnd(40)]) {
      assert.equal(dump.includes(value), false, "a raw value appeared in detector output");
    }
    assert.equal(masked.text.includes("‹secret:aws-key›"), true);
    assert.equal(masked.text.includes("‹secret:private-key›"), true);
    assert.equal(masked.text.includes(dashes), false);
    assert.equal(findings.length, 4);
  });

  it("gives the same fingerprint wherever the line sits", () => {
    const line = `api_key: ${rnd(24)}`;
    const a = scanText(line, "a.md")[0];
    const b = scanText(`\n\n${line}`, "b.md")[0];
    assert.equal(a.fingerprint, b.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{12}$/);
  });
});

describe(".vulcanus-allow parsing", () => {
  it("accepts locations and fingerprints with a reason", () => {
    const list = parseAllow(
      ["# comment", "", "a/b.md:3:aws-key # docs example", "0123456789ab # rotated"].join("\n"),
    );
    assert.deepEqual(list.errors, []);
    assert.equal(list.locations.has("a/b.md:3:aws-key"), true);
    assert.equal(list.fingerprints.has("0123456789ab"), true);
  });

  it("rejects entries without a reason or in a wrong shape", () => {
    const list = parseAllow(["a.md:3:aws-key", "a.md:3:aws-key #   ", "nonsense # why"].join("\n"));
    assert.deepEqual(
      list.errors.map((error) => error.line),
      [1, 2, 3],
    );
  });
});

const parse = (out: string) => JSON.parse(out) as DoctorReport;

describe("vulcanus doctor and secrets", () => {
  async function vaultWithSecret() {
    const root = await tempDir();
    after(() => cleanup(root));
    const input = manifest({ projects: [project("alpha", "Alpha")] });
    await writeFiles(root, generateFiles(input).files);
    await writeManifest(root, input);
    const note = resolve(root, buildPlan(input).allProjects[0].capsule.path);
    const fake = `${["gh", "p_"].join("")}${rnd(36)}`;
    await appendFile(note, `\nnotes\ntoken line ${fake}\n`);
    const text = await (await import("node:fs/promises")).readFile(note, "utf8");
    const line = text.split("\n").findIndex((entry) => entry.includes(fake)) + 1;
    const rel = buildPlan(input).allProjects[0].capsule.path;
    return { root, fake, line, rel };
  }

  async function run(root: string) {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const code = await doctorCommand({ cwd: root, json: true });
      return { code, out: lines.join("") };
    } finally {
      process.stdout.write = original;
    }
  }

  it("reports file:line kind, no value, non-zero exit; allow entry with reason passes", async () => {
    const { root, fake, line, rel } = await vaultWithSecret();

    const first = await run(root);
    assert.notEqual(first.code, 0);
    assert.equal(first.out.includes(fake), false, "doctor printed a raw value");
    const report = parse(first.out);
    const hit = report.findings.find((f) => f.code === "SECRET" && f.level === "error");
    assert.equal(`${hit.file}:${hit.line} ${hit.message}`, `${rel}:${line} github-token`);
    const info = report.findings.find((f) => f.code === "SECRET" && f.level === "info");
    assert.match(info.message, /known patterns/);
    assert.doesNotMatch(info.message, /clean/i);

    // Without a reason the entry is invalid and doctor says so.
    await writeFile(resolve(root, ".vulcanus-allow"), `${rel}:${line}:github-token\n`);
    const bad = await run(root);
    assert.notEqual(bad.code, 0);
    assert.equal(
      parse(bad.out).findings.some((f) => f.code === "SECRET-ALLOW"),
      true,
    );

    await writeFile(
      resolve(root, ".vulcanus-allow"),
      `${rel}:${line}:github-token # test fixture, not real\n`,
    );
    const ok = await run(root);
    assert.equal(ok.code, 0);
    assert.equal(ok.out.includes(fake), false);

    // The fingerprint works too, and survives the line moving.
    await writeFile(
      resolve(root, ".vulcanus-allow"),
      `${hit.fingerprint} # test fixture, not real\n`,
    );
    assert.equal((await run(root)).code, 0);
  });

  it("runDoctor stays ok on a vault with no matches", async () => {
    const root = await tempDir();
    after(() => cleanup(root));
    const input = manifest({ projects: [project("alpha", "Alpha")] });
    await writeFiles(root, generateFiles(input).files);
    await writeManifest(root, input);
    const report = await runDoctor(root, await readManifest(root));
    assert.equal(
      report.findings.some((f) => f.code === "SECRET" && f.level === "error"),
      false,
    );
  });
});
