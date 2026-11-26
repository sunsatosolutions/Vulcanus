/**
 * One agent-file format. A new format is one file that exports an `EmitTemplate`,
 * plus one line in `index.ts`.
 */
export interface EmitTemplate {
  /** Repo-relative, forward-slash path of the file. */
  path: string;
  /** Text placed before the managed block when `emit` creates the file. */
  head?: string;
  /** What goes between the markers, given the rendered project content. */
  body(content: string): string;
  /** True when an existing file already does this template's job without a block. */
  satisfied?(existing: string): boolean;
}
