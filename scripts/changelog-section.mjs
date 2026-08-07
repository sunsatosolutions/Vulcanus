#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md, so the release workflow can use
 * the hand-written notes as the GitHub release body instead of a commit dump.
 *
 *   node scripts/changelog-section.mjs 0.4.0
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version) {
  process.stderr.write("Usage: node scripts/changelog-section.mjs <version>\n");
  process.exit(1);
}

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// `$(?![\s\S])` is end-of-input even under the `m` flag, where a bare `$`
// would match the first line break and cut the section off after one line.
const section = new RegExp(
  `^## ${escaped}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
  "m",
).exec(changelog);

if (!section) {
  process.stderr.write(`CHANGELOG.md has no section for ${version}\n`);
  process.exit(1);
}

process.stdout.write(`${section[1].trim()}\n`);
