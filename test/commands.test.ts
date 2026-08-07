import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { doctorCommand } from "../src/commands/doctor.js";
import { initCommand } from "../src/commands/init.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { readManifest, writeManifest } from "../src/manifest/io.js";
import { MIGRATIONS, migrateManifest } from "../src/manifest/migrate.js";
import { MANIFEST_VERSION } from "../src/manifest/schema.js";
import { setPromptDriver } from "../src/prompts.js";
import { cleanup, manifest, project, scriptedPrompts, tempDir } from "./helpers.js";

const tempDirs: string[] = [];

async function scaffold(input = manifest()) {
  const root = await tempDir();
  tempDirs.push(root);
  const { files } = generateFiles(input);
  await writeFiles(root, files);
  await writeManifest(root, input);
  return root;
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

/** Capture everything a command prints to stdout, restoring the real stream after. */
async function captureStdout<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    const result = await action();
    return { result, output: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

describe("init end to end", () => {
  it("creates a working vault from scripted wizard answers", async () => {
    const target = await tempDir();
    tempDirs.push(target);
    await rm(target, { recursive: true, force: true });

    const { driver, asked } = scriptedPrompts([
      "none", // import an existing AI history?
      "Meridian, Harbor", // manual project list
      "ATLAS", // vault name
      "", // full name
      "", // tagline
      "branded", // naming style
      "core", // system profile
      "Ada", // operator name
      "", // role
      "", // aliases
      "skip", // per-project detail mode
      false, // git init
    ]);
    const restore = setPromptDriver(driver);
    try {
      const { result: code } = await captureStdout(() =>
        initCommand({ locale: "en", yes: true, target }),
      );
      assert.equal(code, 0);
    } finally {
      restore();
    }

    // The wizard asked its questions in the documented order, none twice.
    // No destination question: an explicit --target already answered it.
    const kinds = asked.map((question) => question.kind).join(",");
    assert.equal(kinds, "select,text,text,text,text,select,select,text,text,text,select,confirm");

    const written = await readManifest(target);
    assert.equal(written.vault.name, "ATLAS");
    assert.equal(written.admin.name, "Ada");
    assert.deepEqual(
      written.projects.map((entry) => entry.name),
      ["Meridian", "Harbor"],
    );

    // The generated vault validates cleanly through the real doctor command.
    const { result } = await captureStdout(() => doctorCommand({ cwd: target, json: true }));
    assert.equal(result, 0);
    assert.ok(existsSync(resolve(target, "02_Projects/Meridian/Meridian Capsule.md")));
    assert.ok(existsSync(resolve(target, "AGENTS.md")));
    assert.ok(!existsSync(resolve(target, ".git")), "git init was declined");
  });

  it("continues inside an existing Obsidian vault without identity questions", async () => {
    const root = await tempDir();
    tempDirs.push(root);
    await mkdir(resolve(root, ".obsidian"), { recursive: true });

    const { driver, asked } = scriptedPrompts([
      "none", // import an existing AI history?
      "Meridian", // manual project list
      "skip", // per-project detail mode
      false, // git init
    ]);
    const restore = setPromptDriver(driver);
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      const { result: code } = await captureStdout(() => initCommand({ locale: "en", yes: true }));
      assert.equal(code, 0);
    } finally {
      process.chdir(previousCwd);
      restore();
    }

    // No vault-name, naming, profile, or operator questions were asked.
    const messages = asked.map((question) => question.message).join("\n");
    assert.ok(!/Vault name/i.test(messages));
    assert.ok(!/Your name/i.test(messages));

    const written = await readManifest(root);
    assert.equal(written.vault.naming, "generic");
    assert.ok(existsSync(resolve(root, "00_System/Index.md")));

    // Running init again in the same vault refuses instead of clobbering it.
    const rerun = scriptedPrompts(["none", ""]);
    const restoreRerun = setPromptDriver(rerun.driver);
    process.chdir(root);
    try {
      const { result: again } = await captureStdout(() => initCommand({ locale: "en", yes: true }));
      assert.equal(again, 1);
    } finally {
      process.chdir(previousCwd);
      restoreRerun();
    }
  });
});

describe("init without a TTY", () => {
  it("builds a vault entirely from flags, asking nothing", async () => {
    const target = await tempDir();
    tempDirs.push(target);
    await rm(target, { recursive: true, force: true });

    // A driver with no scripted answers throws on any question.
    const { driver } = scriptedPrompts([]);
    const restore = setPromptDriver(driver);
    try {
      const { result: code } = await captureStdout(() =>
        initCommand({
          locale: "en",
          yes: true,
          target,
          name: "ATLAS",
          operator: "Ada",
          projects: "Meridian, Harbor",
          defaults: true,
          git: false,
        }),
      );
      assert.equal(code, 0);
    } finally {
      restore();
    }

    const written = await readManifest(target);
    assert.equal(written.vault.name, "ATLAS");
    assert.equal(written.admin.name, "Ada");
    assert.deepEqual(
      written.projects.map((entry) => entry.name),
      ["Meridian", "Harbor"],
    );
    assert.ok(!existsSync(resolve(target, ".git")));

    const { result } = await captureStdout(() => doctorCommand({ cwd: target, json: true }));
    assert.equal(result, 0);
  });

  it("requires a name when --defaults cannot invent one", async () => {
    const { driver } = scriptedPrompts([]);
    const restore = setPromptDriver(driver);
    try {
      const { result: code } = await captureStdout(() =>
        initCommand({ locale: "en", yes: true, defaults: true, target: "./nowhere-vault" }),
      );
      assert.equal(code, 2);
    } finally {
      restore();
    }
    assert.ok(!existsSync(resolve(process.cwd(), "nowhere-vault")));
  });

  it("writes nothing on --dry-run and prints the planned tree", async () => {
    const target = await tempDir();
    tempDirs.push(target);
    await rm(target, { recursive: true, force: true });

    const { driver } = scriptedPrompts([]);
    const restore = setPromptDriver(driver);
    try {
      const { result: code } = await captureStdout(() =>
        initCommand({
          locale: "en",
          target,
          name: "ATLAS",
          operator: "Ada",
          projects: "Meridian",
          defaults: true,
          dryRun: true,
        }),
      );
      assert.equal(code, 0);
    } finally {
      restore();
    }

    assert.ok(!existsSync(target), "dry run must not create the vault directory");
  });
});

describe("status command", () => {
  it("exits 2 when there is no vault", async () => {
    const empty = await tempDir();
    tempDirs.push(empty);
    const { statusCommand } = await import("../src/commands/status.js");
    assert.equal(await statusCommand({ cwd: empty, json: true }), 2);
  });

  it("summarizes a healthy vault as JSON", async () => {
    const { statusCommand } = await import("../src/commands/status.js");
    const input = manifest({
      projects: [project("meridian", "Meridian"), project("kiln", "Kiln", { status: "paused" })],
    });
    const root = await scaffold(input);

    const { result, output } = await captureStdout(() => statusCommand({ cwd: root, json: true }));
    assert.equal(result, 0);

    const summary = JSON.parse(output) as {
      vault: string;
      projects: { total: number; active: number; byStatus: Record<string, number> };
      doctor: { ok: boolean; errors: number };
      plannedNotes: number;
      notesOnDisk: number;
      git: unknown;
    };
    assert.equal(summary.vault, "ATLAS");
    assert.equal(summary.projects.total, 2);
    assert.equal(summary.projects.active, 1);
    assert.equal(summary.projects.byStatus.paused, 1);
    assert.equal(summary.doctor.ok, true);
    assert.equal(summary.notesOnDisk, summary.plannedNotes);
    assert.equal(summary.git, null);
  });

  it("flags a broken vault and an older generator", async () => {
    const { statusCommand } = await import("../src/commands/status.js");
    const input = manifest({
      generator: { name: "vulcanus", version: "0.0.1" },
      projects: [project("meridian", "Meridian")],
    });
    const root = await scaffold(input);
    await rm(resolve(root, "02_Projects/Meridian/Meridian Rules.md"));

    const { result, output } = await captureStdout(() => statusCommand({ cwd: root, json: true }));
    assert.equal(result, 1);

    const summary = JSON.parse(output) as {
      doctor: { ok: boolean; errors: number };
      updateAvailable: boolean;
    };
    assert.equal(summary.doctor.ok, false);
    assert.ok(summary.doctor.errors > 0);
    assert.equal(summary.updateAvailable, true);
  });
});

describe("doctor command", () => {
  it("exits 2 when there is no vault", async () => {
    const empty = await tempDir();
    tempDirs.push(empty);
    assert.equal(await doctorCommand({ cwd: empty, json: true }), 2);
  });

  it("repairs a tampered managed file before validating", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const root = await scaffold(input);

    // A generated skill is CLI-owned ("managed"), so repair rewrites it. Notes
    // and hubs are seed or merge files and belong to the operator once written.
    const skillPath = resolve(root, ".claude/skills/atlas-recall/SKILL.md");
    const generated = await readFile(skillPath, "utf8");
    await writeFile(skillPath, "tampered\n", "utf8");

    await captureStdout(() => doctorCommand({ cwd: root, repair: true, json: true }));
    assert.equal(await readFile(skillPath, "utf8"), generated);
  });

  it("leaves a hand-edited Index alone, even on repair", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const root = await scaffold(input);

    // The Index carries the operator's own project overview. Regenerating it
    // used to delete that, which is the one thing a memory tool must not do.
    const indexPath = resolve(root, "00_System/ATLAS Index.md");
    const edited = `${await readFile(indexPath, "utf8")}\n## My Own Section\n\nKeep me.\n`;
    await writeFile(indexPath, edited, "utf8");

    const repaired = await captureStdout(() =>
      doctorCommand({ cwd: root, repair: true, json: true }),
    );
    assert.equal(repaired.result, 0);
    assert.equal(await readFile(indexPath, "utf8"), edited);
  });

  it("emits a machine-readable report with --json", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const root = await scaffold(input);
    await rm(resolve(root, "02_Projects/Meridian/Meridian Rules.md"));

    const { result, output } = await captureStdout(() => doctorCommand({ cwd: root, json: true }));
    assert.equal(result, 1);

    const report = JSON.parse(output) as {
      ok: boolean;
      counts: { error: number };
      findings: Array<{ code: string; file?: string }>;
    };
    assert.equal(report.ok, false);
    assert.ok(report.counts.error > 0);
    assert.ok(
      report.findings.some(
        (finding) =>
          finding.code === "MISSING" && finding.file === "02_Projects/Meridian/Meridian Rules.md",
      ),
    );
  });
});

describe("manifest migration", () => {
  it("stamps an older manifest to the current version with no migrations pending", () => {
    const input = manifest({ manifestVersion: 0 });
    const result = migrateManifest(input);
    assert.equal(result.fromFuture, false);
    assert.deepEqual(result.applied, []);
    assert.equal(result.manifest.manifestVersion, MANIFEST_VERSION);
  });

  it("refuses to touch a manifest from a newer CLI", () => {
    const input = manifest({ manifestVersion: MANIFEST_VERSION + 1 });
    const result = migrateManifest(input);
    assert.equal(result.fromFuture, true);
    assert.equal(result.manifest, input);
  });

  it("applies pending migrations in order and skips already-reached versions", () => {
    const next = MANIFEST_VERSION + 1;
    MIGRATIONS.push(
      {
        // Already satisfied: the manifest is at MANIFEST_VERSION, so this
        // must be skipped rather than reapplied.
        to: MANIFEST_VERSION,
        description: "already applied",
        apply: () => {
          throw new Error("a satisfied migration must never run again");
        },
      },
      {
        to: next,
        description: "add a marker group",
        apply: (input) => ({
          ...input,
          groups: [...input.groups, { id: "migrated", name: "Migrated", navigationOnly: true }],
        }),
      },
    );
    try {
      const result = migrateManifest(manifest());
      assert.deepEqual(
        result.applied.map((entry) => entry.split(":")[0]),
        [`v${next}`],
      );
      assert.equal(result.manifest.manifestVersion, next);
      assert.equal(result.manifest.groups.at(-1)?.name, "Migrated");
    } finally {
      MIGRATIONS.length = 0;
    }
  });
});
