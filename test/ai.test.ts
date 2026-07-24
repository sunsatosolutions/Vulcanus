import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { AI_CLIS, detectAiClis, findOnPath } from "../src/ai/clis.js";
import { buildHandoffPrompt, editableNotes } from "../src/ai/prompt.js";
import { detectSourceDirectories, proposeSourceDirectories } from "../src/ai/workdirs.js";
import { collectProjectDetails, type DetailMode } from "../src/commands/add.js";
import { buildPlan } from "../src/manifest/derive.js";
import { setPromptDriver } from "../src/prompts.js";
import { cleanup, manifest, project, scriptedPrompts, tempDir } from "./helpers.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

/** Stand in for the filesystem so PATH probing is testable on any machine. */
function fakePath(present: string[]) {
  const installed = new Set(present);
  return (path: string) => installed.has(path);
}

describe("AI CLI detection", () => {
  it("finds a command in the first PATH entry that holds it", () => {
    const env = { PATH: ["/opt/bin", "/usr/local/bin"].join(delimiter) };
    const executable = fakePath(["/usr/local/bin/claude", "/opt/bin/codex"]);

    assert.equal(findOnPath("claude", env, executable), "/usr/local/bin/claude");
    assert.equal(findOnPath("codex", env, executable), "/opt/bin/codex");
    assert.equal(findOnPath("gemini", env, executable), null);
  });

  it("reports only the CLIs that are really installed", () => {
    const env = { PATH: "/usr/local/bin" };
    const detected = detectAiClis(env, fakePath(["/usr/local/bin/claude"]));

    assert.deepEqual(
      detected.map((cli) => cli.id),
      ["claude"],
    );
    assert.equal(detected[0].path, "/usr/local/bin/claude");
  });

  it("detects nothing when PATH is empty, so the caller can fall back", () => {
    assert.deepEqual(detectAiClis({ PATH: "" }, fakePath(["/usr/local/bin/claude"])), []);
    assert.deepEqual(detectAiClis({}, fakePath(["/usr/local/bin/claude"])), []);
  });

  it("accepts a renamed binary, and reports the name that actually resolved", () => {
    const env = { PATH: "/usr/local/bin" };
    const detected = detectAiClis(env, fakePath(["/usr/local/bin/agent"]));

    assert.deepEqual(
      detected.map((cli) => cli.id),
      ["cursor-agent"],
    );
    assert.equal(detected[0].command, "agent");
    assert.equal(detected[0].path, "/usr/local/bin/agent");
  });

  it("prefers the primary name when both are installed, so it resolves once", () => {
    const detected = detectAiClis(
      { PATH: "/usr/local/bin" },
      fakePath(["/usr/local/bin/cursor-agent", "/usr/local/bin/agent"]),
    );

    assert.equal(detected.length, 1);
    assert.equal(detected[0].command, "cursor-agent");
  });

  it("passes the task to every CLI as an interactive first prompt", () => {
    for (const cli of AI_CLIS) {
      const args = cli.args("study the codebase");
      assert.ok(args.includes("study the codebase"), `${cli.id} must forward the prompt`);
    }
  });
});

describe("source directory proposals", () => {
  const known = [
    "/Users/ada/code/kiln",
    "/Users/ada/code/northwind",
    "/Users/ada/work/northwind-labs",
    "/Users/ada/code/unrelated",
  ];

  it("proposes the directory whose leaf name matches the project", () => {
    assert.deepEqual(proposeSourceDirectories("Kiln", known), ["/Users/ada/code/kiln"]);
  });

  it("ranks an exact match above a partial one", () => {
    assert.deepEqual(proposeSourceDirectories("Northwind", known), [
      "/Users/ada/code/northwind",
      "/Users/ada/work/northwind-labs",
    ]);
  });

  it("matches across casing, separators, and Turkish characters", () => {
    assert.deepEqual(proposeSourceDirectories("Site Tools", ["/srv/sitetools"]), [
      "/srv/sitetools",
    ]);
    assert.deepEqual(proposeSourceDirectories("Nué Roastery", ["/srv/nue-roastery"]), [
      "/srv/nue-roastery",
    ]);
  });

  it("proposes nothing rather than guessing", () => {
    assert.deepEqual(proposeSourceDirectories("Meridian", known), []);
    assert.deepEqual(proposeSourceDirectories("", known), []);
  });

  it("reads working directories out of local session files", async () => {
    const home = await tempDir();
    tempDirs.push(home);
    const worked = resolve(home, "code/kiln");
    await mkdir(worked, { recursive: true });

    const sessions = resolve(home, ".claude/projects/-Users-ada-code-kiln");
    await mkdir(sessions, { recursive: true });
    await writeFile(
      resolve(sessions, "session.jsonl"),
      `${JSON.stringify({ type: "user", cwd: worked })}\n`,
      "utf8",
    );

    const rollouts = resolve(home, ".codex/sessions/2026/07/24");
    await mkdir(rollouts, { recursive: true });
    await writeFile(
      resolve(rollouts, "rollout-1.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { cwd: resolve(home, "gone") } })}\n`,
      "utf8",
    );

    const found = await detectSourceDirectories(home);
    // Directories that no longer exist are dropped instead of being proposed.
    assert.deepEqual(found, [worked]);
  });
});

describe("handoff prompt", () => {
  const input = manifest({
    projects: [
      project("northwind", "Northwind"),
      project("kiln", "Kiln", { parent: "northwind", specialized: ["Architecture"] }),
    ],
  });
  const plan = buildPlan(input);
  const kiln = plan.allProjects.find((entry) => entry.project.id === "kiln")!;
  const prompt = buildHandoffPrompt(plan, "/Users/ada/ATLAS", {
    project: kiln,
    sourceDir: "/Users/ada/code/kiln",
  });

  it("addresses the notes by absolute path, including specialized ones", () => {
    const notes = editableNotes("/Users/ada/ATLAS", kiln);
    assert.deepEqual(
      notes.map((note) => note.kind),
      ["Capsule", "Hub", "Context", "Decisions", "Rules", "Architecture"],
    );
    assert.equal(
      notes[0].path,
      "/Users/ada/ATLAS/02_Projects/Northwind/Kiln/Kiln Capsule.md",
    );
    for (const note of notes) assert.ok(prompt.includes(note.path), `${note.kind} path is missing`);
  });

  it("names the codebase, the vault, and nothing it should not touch", () => {
    assert.match(prompt, /\/Users\/ada\/code\/kiln/);
    assert.match(prompt, /\/Users\/ada\/ATLAS/);
    assert.match(prompt, /vulcanus\.json/);
    assert.match(prompt, /ask the operator/i);
  });

  it("states the invariants doctor enforces", () => {
    assert.match(prompt, /`type`, `project`, `status`, and `tags`/);
    assert.match(prompt, /exactly one note/);
    assert.match(prompt, /link back to \[\[Kiln Hub\]\]/);
    assert.match(prompt, /\[\[Kiln Capsule\]\]/);
    // The hub's required links come from the plan, so the parent is in there too.
    assert.match(prompt, /\[\[Northwind Hub\]\]/);
    assert.match(prompt, /Needs Confirmation/);
  });

  it("asks for the vault's own language", () => {
    assert.match(prompt, /Write in English/);
    const turkish = buildPlan(
      manifest({
        vault: { ...manifest().vault, language: "tr" },
        projects: [project("kiln", "Kiln")],
      }),
    );
    const trPrompt = buildHandoffPrompt(turkish, "/vault", {
      project: turkish.allProjects[0],
      sourceDir: "/code",
    });
    assert.match(trPrompt, /Write in Turkish/);
  });
});

describe("detail modes", () => {
  const empty = { projects: [], groups: [] };

  /** Run the question flow against a script, always restoring the real driver. */
  async function collect(names: string[], mode: DetailMode, answers: unknown[], base = empty) {
    const { driver, asked } = scriptedPrompts(answers);
    const restore = setPromptDriver(driver);
    try {
      return { ...(await collectProjectDetails(names, base, "en", mode)), asked };
    } finally {
      restore();
    }
  }

  it("seeds untouched project nodes for skip, and asks nothing", async () => {
    const { projects, groups, asked } = await collect(["Kiln", "Kiln"], "skip", []);

    assert.deepEqual(asked, []);
    assert.deepEqual(groups, []);
    assert.deepEqual(
      projects.map((entry) => entry.id),
      ["kiln", "kiln-2"],
    );
    assert.deepEqual(projects[0], {
      id: "kiln",
      name: "Kiln",
      parent: null,
      group: null,
      status: "active",
      summary: "",
      triggers: ["Kiln"],
      specialized: [],
    });
  });

  it("builds the node from the answers, in a fixed order", async () => {
    const { projects, asked } = await collect(["Kiln"], "manual", [
      "A pottery kiln controller.",
      "",
      ["Architecture"],
      "kiln, firing",
    ]);

    assert.deepEqual(
      asked.map((question) => question.kind),
      ["text", "select", "multiselect", "text"],
    );
    // Nothing to be a parent of yet, so only grouping is offered.
    assert.match(asked[1].message, /group/i);
    assert.deepEqual(projects[0], {
      id: "kiln",
      name: "Kiln",
      parent: null,
      group: null,
      status: "active",
      summary: "A pottery kiln controller.",
      triggers: ["kiln", "firing"],
      specialized: ["Architecture"],
    });
  });

  it("asks the AI path the same structural questions, so the graph is never left flat", async () => {
    const answers = ["A pottery kiln controller.", "", ["Architecture"], "kiln, firing"];
    const manual = await collect(["Kiln"], "manual", answers);
    const ai = await collect(["Kiln"], "ai", answers);

    assert.deepEqual(
      ai.asked.map((question) => question.kind),
      manual.asked.map((question) => question.kind),
    );
    assert.deepEqual(ai.projects, manual.projects);
  });

  it("offers an earlier project as a parent, and skips grouping once one is chosen", async () => {
    const { projects, asked } = await collect(["Kiln", "Glaze"], "manual", [
      "Controller.",
      "",
      [],
      "kiln",
      "Glaze calculator.",
      "kiln",
      [],
      "glaze",
    ]);

    assert.deepEqual(asked[5].choices, ["", "kiln"]);
    assert.equal(projects[1].parent, "kiln");
    assert.equal(projects[1].group, null);
    // Four questions for the first project, then parent replaces the group question.
    assert.deepEqual(
      asked.slice(4).map((question) => question.kind),
      ["text", "select", "multiselect", "text"],
    );
  });

  it("creates a group on the fly and reuses its slug", async () => {
    const { projects, groups } = await collect(
      ["Kiln"],
      "manual",
      ["Controller.", "__new__", "Studio Tools", [], "kiln"],
    );

    assert.deepEqual(groups, [{ id: "studio-tools", name: "Studio Tools", navigationOnly: true }]);
    assert.equal(projects[0].group, "studio-tools");
  });

  it("falls back to the project name when no triggers are given", async () => {
    const { projects } = await collect(["Kiln"], "manual", ["Controller.", "", [], "  ,  "]);

    assert.deepEqual(projects[0].triggers, ["Kiln"]);
  });
});
