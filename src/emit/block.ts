import { eolOf, readBlock } from "../memory/rules.js";
import type { EmitTemplate } from "./templates/index.js";

export const BEGIN = "<!-- vulcanus:begin -->";
export const END = "<!-- vulcanus:end -->";
const NOTICE = "<!-- Managed by `vulcanus emit`; edit the vault and run it again. -->";

export type FileState =
  /** The file does not exist; it would be created. */
  | "create"
  /** The file exists without markers; the block would be appended. */
  | "append"
  /** The block exists and differs. */
  | "update"
  | "unchanged"
  /** The markers are damaged; nothing can be written safely. */
  | "broken";

export interface FilePlan {
  path: string;
  state: FileState;
  /** Why the file cannot be written, for `broken`. */
  reason?: string;
  /** Lines of the block as it stands, and as it would be. */
  before: string[];
  after: string[];
  /** The whole file after the change; null for `broken`. */
  text: string | null;
}

export function renderBlock(template: EmitTemplate, content: string): string[] {
  return [BEGIN, NOTICE, ...template.body(content).split("\n"), END];
}

/**
 * The file as `emit` would leave it. Bytes outside the markers are carried over
 * as they are; a file with no markers gets the block appended, never rewritten.
 */
export function planFile(
  template: EmitTemplate,
  existing: string | null,
  content: string,
): FilePlan {
  const lines = renderBlock(template, content);
  const base = { path: template.path, after: lines.slice(1, -1) };
  if (existing === null) {
    return {
      ...base,
      state: "create",
      before: [],
      text: `${template.head ?? ""}${lines.join("\n")}\n`,
    };
  }
  const read = readBlock(existing, BEGIN, END);
  if (read.kind === "broken") {
    return { ...base, state: "broken", reason: read.reason, before: [], text: null };
  }
  const eol = eolOf(existing);
  const block = lines.join(eol);
  if (read.kind === "ok") {
    const text = existing.slice(0, read.from) + block + existing.slice(read.to);
    return {
      ...base,
      state: text === existing ? "unchanged" : "update",
      before: read.body.split(/\r?\n/),
      text,
    };
  }
  if (template.satisfied?.(existing)) {
    return { ...base, state: "unchanged", before: [], text: existing };
  }
  const gap = existing === "" ? "" : existing.endsWith("\n") ? eol : eol + eol;
  return { ...base, state: "append", before: [], text: `${existing}${gap}${block}${eol}` };
}

/**
 * The file with its managed block taken out, for a project that has nothing current
 * left to say; null when the file has no block (nothing of ours to clean up).
 */
export function planRemoval(template: EmitTemplate, existing: string | null): FilePlan | null {
  if (existing === null) return null;
  const read = readBlock(existing, BEGIN, END);
  if (read.kind === "none") return null;
  const base = { path: template.path, after: [] };
  if (read.kind === "broken") {
    return { ...base, state: "broken", reason: read.reason, before: [], text: null };
  }
  const eol = eolOf(existing);
  const tail = existing.slice(read.to).replace(/^\r?\n/, "");
  let head = existing.slice(0, read.from);
  // Only the one blank line `append` put in front of a block at the end is ours.
  if (tail === "" && head.endsWith(eol + eol)) head = head.slice(0, -eol.length);
  return { ...base, state: "update", before: read.body.split(/\r?\n/), text: head + tail };
}
