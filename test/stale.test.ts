import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { reviewCommand } from "../src/commands/review.js";
import { buildVaultServer } from "../src/commands/serve.js";
import { staleCommand } from "../src/commands/stale.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { buildPlan } from "../src/manifest/derive.js";
import { markSection, openVault, recall } from "../src/mcp/tools.js";
import { parseSections, sectionState } from "../src/memory/lifecycle.js";
import { findStale, lineTimes, sectionTime } from "../src/memory/staleness.js";
import { setLogLevel } from "../src/ui.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const parse = <T = Json>(text: string) => JSON.parse(text) as T;
interface Json {
  days: number;
  projects: Array<{ stale: Array<{ heading: string }> }>;
  freshness: { projects: Array<{ stale: unknown[] }> };
}
interface Outcome {
  action: string;
  replacedBy: string;
  commit: string;
}

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
  setLogLevel("normal");
});

const DECISIONS = "02_Projects/Alpha/Alpha Decisions.md";
const RULES = "02_Projects/Alpha/Alpha Rules.md";

function git(cwd: string, args: string[], date?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      ...(date
        ? { GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` }
        : {}),
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function commitAll(cwd: string, date: string, message: string): void {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-m", message], date);
}

const sections = (parts: Record<string, string>) =>
  `# Alpha Decisions\n\n${Object.entries(parts)
    .map(([heading, body]) => `## ${heading}\n\n${body}\n`)
    .join("\n")}`;

/** A vault under git plus a source repo whose last commit is `moved`. */
async function scaffold(options: { vaultGit?: boolean; moved?: string } = {}) {
  const parent = await tempDir();
  tempDirs.push(parent);
  const vault = resolve(parent, "vault");
  const input = manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] });
  await writeFiles(vault, generateFiles(input).files);
  await writeManifest(vault, input);

  const code = resolve(parent, "alpha-src");
  await mkdir(code, { recursive: true });
  await writeFile(resolve(code, "index.ts"), "export {};\n");
  git(code, ["init", "-q"]);
  if (options.moved) {
    commitAll(code, options.moved, "work");
  }
  if (options.vaultGit !== false) git(vault, ["init", "-q"]);
  return { parent, vault, code };
}

const write = (vault: string, path: string, text: string) =>
  mkdir(dirname(resolve(vault, path)), { recursive: true }).then(() =>
    writeFile(resolve(vault, path), text),
  );

describe("section age from its own lines", () => {
  it("keeps an unchanged section old when the section next to it is deleted", async () => {
    const { vault, code } = await scaffold({ moved: "2026-06-01" });
    await write(
      vault,
      DECISIONS,
      sections({ "Use Postgres": "Chosen in January.", "Use Redis": "Added later." }),
    );
    commitAll(vault, "2026-01-01", "decisions");
    // B disappears in a later commit; A is byte-for-byte what it was.
    await write(vault, DECISIONS, sections({ "Use Postgres": "Chosen in January." }));
    commitAll(vault, "2026-05-20", "drop B");
    void code;

    const [alpha] = (
      await findStale(
        vault,
        buildPlan(manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] }))
          .allProjects,
      )
    ).projects;
    const a = alpha.stale.find((item) => item.heading === "Use Postgres");
    assert.ok(a, "A must stay in the stale list");
    assert.equal(a.lastChanged, "2026-01-01");
    assert.equal(a.ageDays, 151);
    assert.equal(alpha.reference?.date, "2026-06-01");
  });

  it("does not age a section from a commit that only moved its neighbour", async () => {
    const { vault } = await scaffold({ moved: "2026-06-01" });
    await write(vault, DECISIONS, sections({ A: "alpha text", B: "beta text", C: "gamma text" }));
    commitAll(vault, "2026-01-01", "first");
    await write(vault, DECISIONS, sections({ A: "alpha text", C: "gamma text", B: "beta text" }));
    commitAll(vault, "2026-05-01", "move B below C");

    const times = await lineTimes(vault, DECISIONS);
    const text = await readFile(resolve(vault, DECISIONS), "utf8");
    const a = parseSections(DECISIONS, text).find((section) => section.heading === "A")!;
    assert.equal(sectionTime(times, a), Date.parse("2026-01-01T12:00:00Z") / 1000);
  });

  it("reports unknown, not a guess, when git has no history", async () => {
    const { vault } = await scaffold({ vaultGit: false, moved: "2026-06-01" });
    await write(vault, DECISIONS, sections({ A: "alpha text" }));
    const input = manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] });
    const [alpha] = (await findStale(vault, buildPlan(input).allProjects)).projects;
    assert.deepEqual(alpha.stale, []);
    assert.deepEqual(
      alpha.unknown.filter((item) => item.note === DECISIONS).map((item) => item.heading),
      ["A"],
    );
  });

  it("honours the threshold, evergreen, and sections that are already history", async () => {
    const { vault } = await scaffold({ moved: "2026-06-01" });
    await write(
      vault,
      DECISIONS,
      sections({
        Old: "old",
        Eternal: "evergreen:: true\n\nnever stale",
        Gone: "valid-until:: 2026-02-01\n\nexpired",
      }),
    );
    commitAll(vault, "2026-01-01", "first");
    const input = manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] });
    const plans = buildPlan(input).allProjects;
    assert.deepEqual(
      (await findStale(vault, plans, 90)).projects[0].stale
        .filter((s) => s.note === DECISIONS)
        .map((s) => s.heading),
      ["Old"],
    );
    assert.deepEqual(
      (await findStale(vault, plans, 200)).projects[0].stale.filter((s) => s.note === DECISIONS),
      [],
    );
  });
});

describe("stale, review, recall, doctor, MCP", () => {
  async function staleVault() {
    const made = await scaffold({ moved: "2026-06-01" });
    await write(
      made.vault,
      DECISIONS,
      sections({ "Use Postgres": "Chosen in January.", "Use Redis": "Cache." }),
    );
    await write(made.vault, RULES, "# Alpha Rules\n\n## Naming Rule\n\nSnake case.\n");
    commitAll(made.vault, "2026-01-01", "notes");
    return made;
  }

  async function quiet<T>(action: () => Promise<T>): Promise<{ result: T; out: string }> {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    };
    try {
      return { result: await action(), out: chunks.join("") };
    } finally {
      process.stdout.write = original;
    }
  }

  it("`stale --json` lists the sections and rejects a bad threshold", async () => {
    const { vault } = await staleVault();
    const { result, out } = await quiet(() => staleCommand(undefined, { cwd: vault, json: true }));
    assert.equal(result, 0);
    const report = parse(out);
    assert.equal(report.days, 90);
    assert.deepEqual(report.projects[0].stale.map((item) => item.heading).sort(), [
      "Naming Rule",
      "Use Postgres",
      "Use Redis",
    ]);
    setLogLevel("quiet");
    assert.equal(await staleCommand(undefined, { cwd: vault, days: "abc" }), 2);
    assert.equal(await staleCommand("nope", { cwd: vault }), 2);
  });

  it("review writes through append_decision and commits; keep resets the age", async () => {
    const { vault } = await staleVault();
    setLogLevel("quiet");

    const supersede = await quiet(() =>
      reviewCommand("Alpha", {
        cwd: vault,
        section: "Use Redis",
        action: "supersede",
        title: "Use Valkey",
        decision: "Valkey replaces Redis.",
        today: "2026-06-02",
        json: true,
      }),
    );
    assert.equal(supersede.result, 0);
    const [done] = parse<Outcome[]>(supersede.out);
    assert.equal(done.action, "supersede");
    assert.equal(done.replacedBy, "Use Valkey");
    assert.match(done.commit, /^[0-9a-f]{7,}$/);
    assert.equal(git(vault, ["rev-parse", "--short", "HEAD"]).trim(), done.commit);
    assert.match(
      git(vault, ["log", "-1", "--format=%s"]),
      /review\(Alpha\): supersede "Use Redis"/,
    );

    const keep = await quiet(() =>
      reviewCommand("Alpha", {
        cwd: vault,
        section: "Use Postgres",
        action: "keep",
        today: "2026-06-02",
        json: true,
      }),
    );
    assert.equal(keep.result, 0);
    const text = await readFile(resolve(vault, DECISIONS), "utf8");
    assert.match(text, /reviewed:: 2026-06-02/);
    assert.match(text, /superseded-by:: \[\[Alpha Decisions#Use Valkey\]\]/);

    const archive = await quiet(() =>
      reviewCommand("Alpha", {
        cwd: vault,
        section: "Naming Rule",
        action: "archive",
        today: "2026-06-02",
        json: true,
      }),
    );
    assert.equal(archive.result, 0);
    const rules = parseSections(RULES, await readFile(resolve(vault, RULES), "utf8"));
    assert.equal(rules[0].archivedOn, "2026-06-02");
    assert.equal(sectionState(rules[0], "2026-06-02"), "expired");

    const input = manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] });
    const [alpha] = (await findStale(vault, buildPlan(input).allProjects)).projects;
    // Valkey and the kept section were touched by a commit made today, not on the project's timeline;
    // what matters is that neither stale entry survives for the sections just reviewed.
    assert.deepEqual(
      alpha.stale.map((item) => item.heading),
      [],
    );
  });

  it("treats a section not yet committed as unknown, not as dated by the zero SHA", async () => {
    const { vault } = await scaffold({ moved: "2026-06-01" });
    await write(vault, DECISIONS, sections({ Old: "old text" }));
    commitAll(vault, "2026-01-01", "first");
    await write(vault, DECISIONS, sections({ Old: "old text", Fresh: "new, uncommitted" }));

    const text = await readFile(resolve(vault, DECISIONS), "utf8");
    const fresh = parseSections(DECISIONS, text).find((section) => section.heading === "Fresh")!;
    assert.equal(sectionTime(await lineTimes(vault, DECISIONS), fresh), null);
    const input = manifest({ projects: [project("alpha", "Alpha", { root: "../alpha-src" })] });
    const [alpha] = (await findStale(vault, buildPlan(input).allProjects)).projects;
    assert.ok(alpha.unknown.some((item) => item.heading === "Fresh"));
  });

  it("archive replaces an existing valid-until instead of leaving the section live", async () => {
    const { vault } = await scaffold({ moved: "2026-06-01" });
    await write(vault, DECISIONS, sections({ Promo: "valid-until:: 2027-12-31\n\nShip free." }));
    commitAll(vault, "2026-01-01", "first");

    const handle = await openVault(vault);
    await markSection(handle, "Alpha", "decisions", "Promo", "archive", "2026-06-02");
    const text = await readFile(resolve(vault, DECISIONS), "utf8");
    assert.equal(text.match(/valid-until::/g)?.length, 1);
    const [promo] = parseSections(DECISIONS, text);
    assert.equal(promo.validUntil, "2026-06-01");
    assert.equal(sectionState(promo, "2026-06-02"), "expired");
  });

  it("review refuses half a request and an unknown section without writing", async () => {
    const { vault } = await staleVault();
    setLogLevel("quiet");
    const before = await readFile(resolve(vault, DECISIONS), "utf8");
    assert.equal(await reviewCommand("Alpha", { cwd: vault, section: "Use Redis" }), 2);
    assert.equal(await reviewCommand("Alpha", { cwd: vault, section: "Nope", action: "keep" }), 2);
    assert.equal(
      await reviewCommand("Alpha", { cwd: vault, section: "Use Redis", action: "bogus" }),
      2,
    );
    assert.equal(await readFile(resolve(vault, DECISIONS), "utf8"), before);
  });

  it("recall labels stale sections `stale?`, and the MCP `stale` tool lists them", async () => {
    const { vault } = await staleVault();
    const handle = await openVault(vault);
    const result = await recall(handle, "alpha");
    assert.ok(result?.staleSections?.every((item) => item.label === "stale?"));
    assert.deepEqual(result?.staleSections?.map((item) => item.heading).sort(), [
      "Naming Rule",
      "Use Postgres",
      "Use Redis",
    ]);

    const server = buildVaultServer(vault);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "stale"));
    const call = await client.callTool({
      name: "stale",
      arguments: { project: "Alpha", days: 90 },
    });
    const text = (call.content as Array<{ text: string }>)[0].text;
    assert.equal(parse(text).projects[0].stale.length, 3);
    const short = await client.callTool({
      name: "stale",
      arguments: { project: "Alpha", days: 400 },
    });
    assert.equal(
      parse((short.content as Array<{ text: string }>)[0].text).projects[0].stale.length,
      0,
    );
    await client.close();
  });

  it("doctor --freshness is advisory: it lists sections and still passes", async () => {
    const { vault } = await staleVault();
    const { out } = await quiet(() => doctorCommand({ cwd: vault, json: true, freshness: true }));
    const report = parse(out);
    assert.equal(report.freshness.projects[0].stale.length, 3);
    const plain = await quiet(() => doctorCommand({ cwd: vault, json: true }));
    assert.equal("freshness" in parse(plain.out), false);
  });
});
