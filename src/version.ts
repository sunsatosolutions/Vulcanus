/** Kept in sync with package.json; used in the manifest's generator stamp. */
export const CLI_VERSION = "0.3.3";

/**
 * The published package name. The unscoped `vulcanus` on npm belongs to an
 * unrelated project, so the update check must query the scoped name or it would
 * report that package's releases as ours.
 */
export const PACKAGE_NAME = "@sunsato/vulcanus";

/**
 * The agent protocol AGENTS.md describes. Bumped whenever the instructions
 * agents follow change in a way that matters — a new required step, a changed
 * read order, a new command in the workflow.
 *
 * AGENTS.md is a managed file, so `vulcanus update` rewrites it; the stamp is
 * what lets `doctor` notice that a vault is still carrying the old protocol.
 */
export const PROTOCOL_VERSION = 1;
