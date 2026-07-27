/** Kept in sync with package.json; used in the manifest's generator stamp. */
export const CLI_VERSION = "0.3.2";

/**
 * The published package name. The unscoped `vulcanus` on npm belongs to an
 * unrelated project, so the update check must query the scoped name or it would
 * report that package's releases as ours.
 */
export const PACKAGE_NAME = "@sunsato/vulcanus";
