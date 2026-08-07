import assert from "node:assert/strict";
import { readFile, utimes } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildVaultServer } from "../src/commands/serve.js";
import { generateFiles, writeFiles } from "../src/generate/index.js";
import { writeManifest } from "../src/manifest/io.js";
import { appendRule, openVault, recall, replaceSection, updateCapsule } from "../src/mcp/tools.js";
import { cleanup, manifest, project, tempDir } from "./helpers.js";

const tempDirs: string[] = [];

const INPUT = manifest({
  projects: [project("meridian", "Meridian", { triggers: ["meridian"] })],
});

async function scaffold(input = INPUT) {
  const root = await tempDir();
  tempDirs.push(root);
  const { files } = generateFiles(input);
  await writeFiles(root, files);
  await writeManifest(root, input);
  return root;
}

/** A client wired to the real server over the SDK's in-memory transport pair. */
async function connect(vaultRoot: string) {
  const server = buildVaultServer(vaultRoot);
  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((entry) => entry.text ?? "").join("");
}

after(async () => {
  for (const dir of tempDirs) await cleanup(dir);
});

describe("mcp server registration", () => {
  it("advertises every vault tool", async () => {
    const { client, close } = await connect(await scaffold());
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        "append_decision",
        "append_rule",
        "doctor",
        "list_projects",
        "recall",
        "search",
        "update_capsule",
        "vault_status",
      ]);
      // A tool with no description is a tool a model will not call correctly.
      for (const tool of tools) {
        assert.ok((tool.description ?? "").length > 40, `${tool.name} needs a real description`);
      }
    } finally {
      await close();
    }
  });

  it("answers recall over the transport", async () => {
    const { client, close } = await connect(await scaffold());
    try {
      const result = await client.callTool({ name: "recall", arguments: { project: "meridian" } });
      const parsed = JSON.parse(textOf(result)) as { project: string; readNext: unknown[] };
      assert.equal(parsed.project, "Meridian");
      assert.ok(parsed.readNext.length > 0);
    } finally {
      await close();
    }
  });

  it("reports an unknown project as a tool error, not a crash", async () => {
    const { client, close } = await connect(await scaffold());
    try {
      const result = await client.callTool({ name: "recall", arguments: { project: "nope" } });
      assert.equal((result as { isError?: boolean }).isError, true);
      assert.match(textOf(result), /Known projects: Meridian/);
    } finally {
      await close();
    }
  });

  it("writes a decision through the server", async () => {
    const root = await scaffold();
    const { client, close } = await connect(root);
    try {
      await client.callTool({
        name: "append_decision",
        arguments: {
          project: "meridian",
          title: "Ship weekly",
          decision: "Meridian ships every Thursday.",
        },
      });
      const note = await readFile(
        resolve(root, "02_Projects/Meridian/Meridian Decisions.md"),
        "utf8",
      );
      assert.match(note, /## Ship weekly/);
      assert.match(note, /Meridian ships every Thursday\./);
    } finally {
      await close();
    }
  });
});

describe("capsule and rule writes", () => {
  it("replaces one section and leaves the rest alone", () => {
    const note = ["# X", "", "## Identity", "", "old", "", "## Must Remember", "", "- keep"].join(
      "\n",
    );
    const updated = replaceSection(note, "Identity", "new");
    assert.ok(updated);
    assert.match(updated, /## Identity\n\nnew/);
    assert.match(updated, /## Must Remember\n\n- keep/);
    assert.ok(!updated.includes("old"));
  });

  it("returns null for a heading the note does not have", () => {
    assert.equal(replaceSection("## Identity\n\nx\n", "Nonexistent", "y"), null);
  });

  it("updates a capsule section in place", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const result = await updateCapsule(handle, "meridian", "Identity", "Meridian is the router.");

    assert.equal(result?.replaced, true);
    const capsule = await readFile(
      resolve(root, "02_Projects/Meridian/Meridian Capsule.md"),
      "utf8",
    );
    assert.match(capsule, /## Identity\n\nMeridian is the router\./);
    // The generated read order is not the agent's to rewrite.
    assert.match(capsule, /## Read Next/);
    assert.match(capsule, /\[\[Meridian Hub\]\]/);
  });

  it("appends a rule under its own heading", async () => {
    const root = await scaffold();
    const handle = await openVault(root);
    const result = await appendRule(handle, "meridian", "Naming", "Use lowercase ids.");

    assert.equal(result?.rule, "Naming Rule");
    const rules = await readFile(resolve(root, "02_Projects/Meridian/Meridian Rules.md"), "utf8");
    assert.match(rules, /## Naming Rule\n\nUse lowercase ids\./);
  });

  it("warns when the capsule is older than the notes it summarizes", async () => {
    const root = await scaffold();
    const handle = await openVault(root);

    const capsule = resolve(root, "02_Projects/Meridian/Meridian Capsule.md");
    const decisions = resolve(root, "02_Projects/Meridian/Meridian Decisions.md");
    const old = new Date(Date.now() - 86_400_000);
    const now = new Date();
    await utimes(capsule, old, old);
    await utimes(decisions, now, now);

    const result = await recall(handle, "meridian");
    assert.match(result?.staleWarning ?? "", /Meridian Decisions/);
    assert.match(result?.staleWarning ?? "", /older than/);
  });

  it("says nothing about staleness when the capsule is current", async () => {
    const handle = await openVault(await scaffold());
    const result = await recall(handle, "meridian");
    assert.equal(result?.staleWarning, undefined);
  });
});
