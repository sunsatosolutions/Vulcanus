import { relative, sep } from "node:path";

/**
 * Vault-internal paths — manifest entries, wikilink targets, doctor findings —
 * are always written with forward slashes, on every platform, because they end
 * up inside Markdown notes that must read the same in a repository cloned on
 * Windows and on macOS. Anything derived from the filesystem goes through here
 * before it is compared against a planned path or written into a note.
 */
export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** `relative()` with the result normalized to vault path form. */
export function vaultRelative(root: string, absolute: string): string {
  return toPosix(relative(root, absolute));
}
