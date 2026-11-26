import type { EmitTemplate } from "./types.js";

/** Copilot reads one repository-wide file and has no import syntax, so it gets a copy. */
export const copilot: EmitTemplate = {
  path: ".github/copilot-instructions.md",
  body: (content) => content,
};
