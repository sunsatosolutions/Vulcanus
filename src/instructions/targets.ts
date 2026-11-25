import { createHash } from "node:crypto";

/**
 * The one table every agent-instruction file is derived from. `AGENTS.md` is the
 * source; each tool that does not read it directly gets a bridge file here.
 * `bridge` writes from this table and `doctor` checks against it, so the two
 * cannot disagree about what a bridge file is.
 */
export const SOURCE_FILE = "AGENTS.md";

export interface Target {
  /** Repo-relative, forward-slash path of the bridge file. */
  path: string;
  /** `import`: a stub the tool expands itself. `copy`: the source text, generated. */
  mode: "import" | "copy";
  /** Text placed before the Vulcanus marker (a tool's required frontmatter). */
  preamble?: string;
  /** Vault-generated file that already covers this tool; no second copy beside it. */
  vaultTwin?: string;
  /** Where the tool documents how it reads this file. */
  docs: string;
}

export const TARGETS: readonly Target[] = [
  {
    // Claude Code expands `@path` imports in CLAUDE.md.
    // https://docs.claude.com/en/docs/claude-code/memory
    path: "CLAUDE.md",
    mode: "import",
    vaultTwin: "CLAUDE.md",
    docs: "https://docs.claude.com/en/docs/claude-code/memory",
  },
  {
    // Gemini CLI expands `@file.md` imports in GEMINI.md.
    // https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
    path: "GEMINI.md",
    mode: "import",
    docs: "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md",
  },
  {
    // Copilot reads one repository-wide file and has no import syntax.
    // https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
    path: ".github/copilot-instructions.md",
    mode: "copy",
    docs: "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions",
  },
  {
    // Cursor rules are `.mdc` files with frontmatter; the copy keeps it first.
    // https://docs.cursor.com/context/rules
    path: ".cursor/rules/agents.mdc",
    mode: "copy",
    preamble:
      "---\ndescription: Project instructions mirrored from AGENTS.md\nalwaysApply: true\n---\n",
    vaultTwin: ".cursor/rules/vault.mdc",
    docs: "https://docs.cursor.com/context/rules",
  },
];

/** Line endings do not change the hash: a CRLF checkout is the same instruction text. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

const MARKER = /^<!--\s*vulcanus:bridge\s+source=(\S+?)(?:\s+sha256=([0-9a-f]{64}))?\s*-->/;

export interface Marker {
  source: string;
  /** Present on copies only. */
  sha256?: string;
}

/**
 * The Vulcanus marker, only where `bridge` writes it: the first line, or the first line
 * after a leading frontmatter block. A marker quoted in an example or prose is not ownership.
 */
export function readMarker(text: string): Marker | null {
  const body = text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const found = MARKER.exec(body);
  return found ? { source: found[1], sha256: found[2] } : null;
}

/** The exact file `bridge` writes for a target, given the source text. */
export function renderTarget(target: Target, source: string): string {
  const preamble = target.preamble ?? "";
  if (target.mode === "import") {
    return `${preamble}<!-- vulcanus:bridge source=${SOURCE_FILE} -->\n@${SOURCE_FILE}\n`;
  }
  const body = source.replace(/\r\n/g, "\n");
  return [
    `${preamble}<!-- vulcanus:bridge source=${SOURCE_FILE} sha256=${sourceHash(source)} -->`,
    `<!-- Generated from ${SOURCE_FILE}; edit that file and run \`vulcanus bridge --write\`. -->`,
    "",
    body.endsWith("\n") ? body : `${body}\n`,
  ].join("\n");
}
