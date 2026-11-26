import type { EmitTemplate } from "./types.js";

/** Claude Code expands `@path` imports in CLAUDE.md, so the block only points at AGENTS.md. */
export const claude: EmitTemplate = {
  path: "CLAUDE.md",
  body: () => "@AGENTS.md",
  // A CLAUDE.md that already imports AGENTS.md (for example from `vulcanus bridge`) needs no second import.
  satisfied: (existing) => /^@AGENTS\.md[ \t]*$/m.test(existing),
};
