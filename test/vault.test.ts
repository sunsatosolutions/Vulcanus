import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { runDoctor } from "../src/doctor/index.js";
import { buildPlan } from "../src/manifest/derive.js";
import { validateManifest } from "../src/manifest/schema.js";
import { slugify } from "../src/util/text.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];

async function scaffold(input = manifest()) {
  const root = await tempDir();
  tempDirs.push(root);
  const { files, plan } = generateFiles(input);
  await writeFiles(root, files);
  return { root, plan, manifest: input, files };
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

describe("generator", () => {
  it("produces a vault that passes its own validation", async () => {
    const input = manifest({
      vault: { ...manifest().vault, profile: "full" },
      groups: [{ id: "branding", name: "Branding", navigationOnly: true }],
      projects: [
        project("northwind", "Northwind"),
        project("kiln", "Kiln", { parent: "northwind", specialized: ["Architecture", "Flow"] }),
        project("labs", "Northwind Labs", { parent: "northwind", dirName: "Labs" }),
        project("lumen", "Lumen", { group: "branding", specialized: ["Visual Direction"] }),
      ],
    });

    const { root } = await scaffold(input);
    const report = await runDoctor(root, input);

    assert.equal(report.counts.error, 0, JSON.stringify(report.findings, null, 2));
    assert.equal(report.counts.warning, 0, JSON.stringify(report.findings, null, 2));
    assert.ok(report.filesChecked > 20);
    assert.ok(report.linksChecked > 50);
  });

  it("nests project folders by parent and honours dirName", async () => {
    const input = manifest({
      projects: [
        project("northwind", "Northwind"),
        project("labs", "Northwind Labs", { parent: "northwind", dirName: "Labs" }),
      ],
    });
    const { root } = await scaffold(input);

    assert.ok(existsSync(resolve(root, "02_Projects/Northwind/Northwind Hub.md")));
    assert.ok(existsSync(resolve(root, "02_Projects/Northwind/Labs/Northwind Labs Hub.md")));
  });

  it("uses generic system note names when naming is generic", async () => {
    const input = manifest({ vault: { ...manifest().vault, naming: "generic" } });
    const { root } = await scaffold(input);

    assert.ok(existsSync(resolve(root, "00_System/Index.md")));
    assert.ok(!existsSync(resolve(root, "00_System/ATLAS Index.md")));
  });

  it("never overwrites operator-edited notes without force", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root, files } = await scaffold(input);

    const contextPath = resolve(root, "02_Projects/Meridian/Meridian Context.md");
    const edited = `${await readFile(contextPath, "utf8")}\n\nHand-written memory.\n`;
    await writeFile(contextPath, edited, "utf8");

    await writeFiles(root, files, { repair: true });
    assert.match(await readFile(contextPath, "utf8"), /Hand-written memory\./);
  });
});

describe("doctor", () => {
  it("reports a broken wikilink", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root } = await scaffold(input);

    const rulesPath = resolve(root, "02_Projects/Meridian/Meridian Rules.md");
    const content = await readFile(rulesPath, "utf8");
    await writeFile(rulesPath, `${content}\n\nSee [[Nowhere Note]].\n`, "utf8");

    const report = await runDoctor(root, input);
    assert.ok(report.findings.some((finding) => finding.code === "BROKEN"));
    assert.equal(report.ok, false);
  });

  it("reports a project note that lost its return link", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root } = await scaffold(input);

    const contextPath = resolve(root, "02_Projects/Meridian/Meridian Context.md");
    const stripped = (await readFile(contextPath, "utf8")).replace("[[Meridian Hub]]", "Meridian Hub");
    await writeFile(contextPath, stripped, "utf8");

    const report = await runDoctor(root, input);
    assert.ok(report.findings.some((finding) => finding.code === "RETURN"));
  });

  it("reports a missing recall route", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root, plan } = await scaffold(input);

    const recallPath = resolve(root, plan.recallMap.path);
    const stripped = (await readFile(recallPath, "utf8")).replaceAll("[[Meridian Capsule]]", "Meridian Capsule");
    await writeFile(recallPath, stripped, "utf8");

    const report = await runDoctor(root, input);
    assert.ok(report.findings.some((finding) => finding.code === "RECALL"));
  });

  it("reports a missing planned note", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root } = await scaffold(input);

    const { rm } = await import("node:fs/promises");
    await rm(resolve(root, "02_Projects/Meridian/Meridian Decisions.md"));

    const report = await runDoctor(root, input);
    assert.ok(report.findings.some((finding) => finding.code === "MISSING"));
  });
});

describe("manifest validation", () => {
  it("rejects projects whose note basenames would collide", () => {
    const issues = validateManifest(
      manifest({ projects: [project("a", "Meridian"), project("b", "meridian")] }),
    );
    assert.ok(issues.some((issue) => issue.level === "error" && /share the name/.test(issue.message)));
  });

  it("rejects a hierarchy cycle", () => {
    const issues = validateManifest(
      manifest({
        projects: [
          project("a", "A", { parent: "b" }),
          project("b", "B", { parent: "a" }),
        ],
      }),
    );
    assert.ok(issues.some((issue) => /cycle/.test(issue.message)));
  });

  it("rejects an unknown parent", () => {
    const issues = validateManifest(
      manifest({ projects: [project("a", "A", { parent: "ghost" })] }),
    );
    assert.ok(issues.some((issue) => /unknown parent/.test(issue.message)));
  });
});

describe("plan expectations", () => {
  it("links a grouped project's hub to the group hub, not the index", () => {
    const input = manifest({
      groups: [{ id: "branding", name: "Branding", navigationOnly: true }],
      projects: [project("lumen", "Lumen", { group: "branding" })],
    });
    const plan = buildPlan(input);
    const lumen = plan.allProjects.find((entry) => entry.project.id === "lumen")!;

    assert.equal(lumen.parentLink.name, "Branding Hub");
  });
});

describe("slugify", () => {
  it("transliterates Turkish and accented characters", () => {
    assert.equal(slugify("Nué Roastery"), "nue-roastery");
    assert.equal(slugify("Işık Şirketi"), "isik-sirketi");
    assert.equal(slugify("ARIA"), "aria");
  });
});

describe("adding a project to an existing vault", () => {
  it("patches the recall map and the parent hub in place", async () => {
    const { applyProjects } = await import("../src/commands/add.js");
    const { writeManifest } = await import("../src/manifest/io.js");

    const input = manifest({ projects: [project("northwind", "Northwind")] });
    const { root, plan } = await scaffold(input);
    await writeManifest(root, input);

    const parentHubBefore = await readFile(resolve(root, "02_Projects/Northwind/Northwind Hub.md"), "utf8");
    assert.ok(!parentHubBefore.includes("[[Harbor Hub]]"));

    const result = await applyProjects(root, input, {
      projects: [project("harbor", "Harbor", { parent: "northwind" })],
      groups: [],
    });

    assert.equal(result.ok, true);

    const recall = await readFile(resolve(root, plan.recallMap.path), "utf8");
    assert.match(recall, /### Harbor/);
    assert.match(recall, /\[\[Harbor Capsule\]\]/);

    const parentHub = await readFile(resolve(root, "02_Projects/Northwind/Northwind Hub.md"), "utf8");
    assert.match(parentHub, /\[\[Harbor Hub\]\]/);

    assert.ok(existsSync(resolve(root, "02_Projects/Northwind/Harbor/Harbor Capsule.md")));
  });
});

describe("update", () => {
  it("creates newly planned notes and stamps the CLI version", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const { writeManifest, readManifest } = await import("../src/manifest/io.js");
    const { CLI_VERSION } = await import("../src/version.js");

    // A vault written by an older CLI, with the shallower system layer.
    const input = manifest({
      generator: { name: "vulcanus", version: "0.0.1" },
      projects: [project("northwind", "Northwind")],
    });
    const { root } = await scaffold(input);
    await writeManifest(root, input);

    assert.ok(!existsSync(resolve(root, "00_System/ATLAS Brain OS Architecture.md")));

    const code = await updateCommand({ cwd: root, profile: "full", json: true });
    assert.equal(code, 0);

    assert.ok(existsSync(resolve(root, "00_System/ATLAS Brain OS Architecture.md")));

    const after = await readManifest(root);
    assert.equal(after.generator.version, CLI_VERSION);
    assert.equal(after.vault.profile, "full");
  });

  it("preserves hand-written notes and writes nothing on a dry run", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const { writeManifest } = await import("../src/manifest/io.js");

    const input = manifest({
      generator: { name: "vulcanus", version: "0.0.1" },
      projects: [project("meridian", "Meridian")],
    });
    const { root } = await scaffold(input);
    await writeManifest(root, input);

    const contextPath = resolve(root, "02_Projects/Meridian/Meridian Context.md");
    await writeFile(`${contextPath}`, `${await readFile(contextPath, "utf8")}\nOwn memory.\n`, "utf8");

    await updateCommand({ cwd: root, json: true });
    assert.match(await readFile(contextPath, "utf8"), /Own memory\./);

    const beforeDryRun = await readFile(resolve(root, "AGENTS.md"), "utf8");
    await writeFile(resolve(root, "AGENTS.md"), "tampered\n", "utf8");
    await updateCommand({ cwd: root, dryRun: true, json: true });
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), "tampered\n");

    await updateCommand({ cwd: root, json: true });
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), beforeDryRun);
  });

  it("refuses a vault written by a newer manifest version", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const { writeManifest } = await import("../src/manifest/io.js");

    const input = manifest({ manifestVersion: 99 });
    const { root } = await scaffold(input);
    await writeManifest(root, input);

    assert.equal(await updateCommand({ cwd: root, json: true }), 2);
  });
});

describe("version comparison", () => {
  it("orders releases and prereleases", async () => {
    const { compareVersions, isNewer } = await import("../src/util/semver.js");

    assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
    assert.ok(compareVersions("1.0.0", "1.0.0") === 0);
    assert.ok(compareVersions("1.0.0-beta.1", "1.0.0") < 0);
    assert.ok(isNewer("0.2.0", "0.1.0"));
    assert.ok(!isNewer("0.1.0", "0.2.0"));
    // Unparsable stamps must never look like an available update.
    assert.equal(compareVersions("test", "0.1.0"), 0);
  });
});

describe("update check", () => {
  it("is opt-out via environment and never reports on an unknown version", async () => {
    const { updateCheckDisabled, updateNotice } = await import("../src/update-check.js");

    const previous = process.env.VULCANUS_NO_UPDATE_CHECK;
    process.env.VULCANUS_NO_UPDATE_CHECK = "1";
    try {
      assert.equal(updateCheckDisabled(), true);
      // Disabled means no network call and therefore no notice.
      assert.equal(await updateNotice("0.0.1"), null);
    } finally {
      if (previous === undefined) delete process.env.VULCANUS_NO_UPDATE_CHECK;
      else process.env.VULCANUS_NO_UPDATE_CHECK = previous;
    }
  });
});

describe("agent adoption files", () => {
  it("ships the enforcement layer and a setup guide", async () => {
    const input = manifest({ projects: [project("meridian", "Meridian")] });
    const { root } = await scaffold(input);

    for (const file of ["AGENTS.md", "CLAUDE.md", ".cursor/rules/vault.mdc", "USING-WITH-AI.md"]) {
      assert.ok(existsSync(resolve(root, file)), `${file} should be generated`);
    }

    const guide = await readFile(resolve(root, "USING-WITH-AI.md"), "utf8");
    assert.match(guide, /~\/\.claude\/CLAUDE\.md/);
    assert.match(guide, /Obsidian/);
  });

  it("builds an enforcement snippet naming the vault, operator, and path", async () => {
    const { enforcementSnippet } = await import("../src/generate/agents.js");
    const plan = buildPlan(manifest({ projects: [project("meridian", "Meridian")] }));
    const snippet = enforcementSnippet(plan, "/Users/ada/ATLAS");

    assert.match(snippet, /ATLAS is my second brain/);
    assert.match(snippet, /\/Users\/ada\/ATLAS\/AGENTS\.md/);
    assert.match(snippet, /Ada is the operator/);
    assert.match(snippet, /Needs Confirmation/);
  });
});
