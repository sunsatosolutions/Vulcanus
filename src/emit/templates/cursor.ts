import type { EmitTemplate } from "./types.js";

/** A Cursor rule file: `.mdc` frontmatter, always applied. */
export const cursor: EmitTemplate = {
  path: ".cursor/rules/vulcanus.mdc",
  head: "---\ndescription: Project rules and context from the vault\nalwaysApply: true\n---\n\n",
  body: (content) => content,
};
