import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runDoctor } from "../doctor/index.js";
import { findVaultRoot } from "../manifest/io.js";
import {
  appendDecision,
  appendRule,
  CAPSULE_SECTIONS,
  listProjects,
  openVault,
  recall,
  search,
  updateCapsule,
} from "../mcp/tools.js";
import { CLI_VERSION } from "../version.js";
import { collectStatus } from "./status.js";

export interface ServeOptions {
  cwd?: string;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * The answer when a tool is called somewhere that is not a vault. It is a tool
 * result rather than a startup refusal because a client that registered the
 * server globally starts it in whatever directory the operator is working in,
 * and one of those directories having no vault must not take the server down.
 */
function noVaultFailure(start: string) {
  return failure(
    [
      `No vault here: looked in ${start} and every parent directory for a vulcanus.json.`,
      "Create one with `vulcanus init`, or start the server against an existing vault with `vulcanus serve --cwd <vault>`.",
    ].join("\n"),
  );
}

/**
 * Serve the vault over MCP (stdio), so MCP clients — Claude Code, Cursor, or
 * any agent runtime — can recall, search, and extend the vault's memory as
 * structured tools instead of ad-hoc file reads.
 *
 * The manifest is re-read on every call: the operator and other agents keep
 * editing the vault while the server runs, and stale plans must never answer.
 */
/**
 * Build the server with every vault tool registered, without connecting it to
 * a transport. Keeping construction separate is what lets the registration
 * itself be tested over an in-memory transport instead of only the functions
 * behind it.
 */
export function buildVaultServer(start: string): McpServer {
  const server = new McpServer({ name: "vulcanus", version: CLI_VERSION });

  // Resolved per call, not once at construction: the vault can be created,
  // moved, or left behind while the server is running, and every tool already
  // re-reads the manifest for the same reason.
  const vault = () => findVaultRoot(start);

  server.registerTool(
    "recall",
    {
      title: "Recall a project",
      description:
        "The entry point before working on any project: returns its Capsule (the compressed must-remember summary) plus the read-next list for deeper context. Query by project name, id, or a trigger word.",
      inputSchema: { project: z.string().describe("Project name, id, or trigger word") },
    },
    async ({ project }) => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      const result = await recall(handle, project);
      if (!result) {
        return failure(
          `No project matches "${project}". Known projects: ${listProjects(handle)
            .map((entry) => entry.name)
            .join(", ")}`,
        );
      }
      return json(result);
    },
  );

  server.registerTool(
    "search",
    {
      title: "Search the vault",
      description:
        "Layer-aware text search across the vault. Capsule and Recall Map hits rank first so the cheapest sufficient note surfaces on top.",
      inputSchema: {
        query: z.string().describe("Text to look for"),
        limit: z.number().int().min(1).max(100).optional().describe("Max hits, default 20"),
      },
    },
    async ({ query, limit }) => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      return json(await search(handle, query, limit ?? 20));
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "The routing table: every project with its status, summary, trigger words, and capsule path.",
      inputSchema: {},
    },
    async () => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      return json(listProjects(await openVault(vaultRoot)));
    },
  );

  server.registerTool(
    "append_decision",
    {
      title: "Record a decision",
      description:
        "Append a confirmed decision to a project's Decisions note, in the vault's Decision/Details format. Only record what the operator has actually confirmed.",
      inputSchema: {
        project: z.string().describe("Project name, id, or trigger word"),
        title: z.string().describe("Short heading for the decision"),
        decision: z.string().describe("The decision itself, one or two sentences"),
        details: z.string().optional().describe("Optional supporting details"),
      },
    },
    async ({ project, title, decision, details }) => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      const result = await appendDecision(handle, project, title, decision, details);
      if (!result)
        return failure(`No project matches "${project}", or its Decisions note is missing.`);
      return json(result);
    },
  );

  server.registerTool(
    "update_capsule",
    {
      title: "Refresh a capsule section",
      description:
        "Replace one section of a project's Capsule — the compressed summary every recall reads first. Use it after the operator confirms something that makes the summary wrong or incomplete; never to record a guess. `Read Next` is generated and cannot be written here.",
      inputSchema: {
        project: z.string().describe("Project name, id, or trigger word"),
        section: z.enum(CAPSULE_SECTIONS).describe("Which capsule section to replace"),
        body: z.string().describe("The section's new Markdown body, without the heading itself"),
      },
    },
    async ({ project, section, body }) => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      const result = await updateCapsule(handle, project, section, body);
      if (!result) return failure(`No project matches "${project}", or its Capsule is missing.`);
      return json(result);
    },
  );

  server.registerTool(
    "append_rule",
    {
      title: "Record a rule",
      description:
        "Add a durable rule to a project's Rules note. Rules are standing constraints the operator has confirmed — how to work on this project, what never to assume — not observations about one conversation.",
      inputSchema: {
        project: z.string().describe("Project name, id, or trigger word"),
        name: z.string().describe('Short name for the rule, e.g. "Naming"'),
        rule: z.string().describe("The rule itself, in one or two sentences"),
      },
    },
    async ({ project, name, rule }) => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      const result = await appendRule(handle, project, name, rule);
      if (!result) return failure(`No project matches "${project}", or its Rules note is missing.`);
      return json(result);
    },
  );

  server.registerTool(
    "vault_status",
    {
      title: "Vault status",
      description:
        "One-shot health summary: projects, note counts, doctor result, stale capsules, git state.",
      inputSchema: {},
    },
    async () => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      return json(await collectStatus(vaultRoot));
    },
  );

  server.registerTool(
    "doctor",
    {
      title: "Validate the vault",
      description: "Run the full structural validation and return every finding.",
      inputSchema: {},
    },
    async () => {
      const vaultRoot = vault();
      if (!vaultRoot) return noVaultFailure(start);
      const handle = await openVault(vaultRoot);
      return json(await runDoctor(vaultRoot, handle.manifest));
    },
  );

  return server;
}

export async function serveCommand(options: ServeOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();

  // Starting without a vault is deliberate. MCP clients register this server
  // once and launch it in whatever directory the operator opened, so refusing
  // to start would take the tools away everywhere except inside the vault —
  // and the client reports that as a broken server rather than a missing
  // vault. Introspection answers either way; the tools say what is wrong.
  const server = buildVaultServer(start);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const vaultRoot = findVaultRoot(start);
  process.stderr.write(
    vaultRoot
      ? `vulcanus mcp server ready — vault: ${vaultRoot}\n`
      : `vulcanus mcp server ready — no vault under ${start}; tools will report that until one exists\n`,
  );

  // Stay alive until the client closes stdin.
  await new Promise<void>((resolvePromise) => {
    transport.onclose = () => resolvePromise();
    process.stdin.on("end", () => resolvePromise());
  });
  return 0;
}
