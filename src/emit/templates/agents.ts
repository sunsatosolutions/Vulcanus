import type { EmitTemplate } from "./types.js";

/** The source file: Codex, and every tool that reads AGENTS.md, get the content itself. */
export const agents: EmitTemplate = {
  path: "AGENTS.md",
  body: (content) => content,
};
