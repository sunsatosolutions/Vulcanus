#!/usr/bin/env node
/**
 * Prepare a release: bump the version everywhere it is written down, and turn
 * the CHANGELOG's `## Unreleased` heading into a dated release heading.
 *
 * The CHANGELOG here is hand-written prose rather than generated from commit
 * subjects, so this script deliberately does not author entries — it only
 * stamps the section that is already there. Publishing happens in CI when the
 * `v<version>` tag is pushed; see .github/workflows/release.yml.
 *
 *   node scripts/release.mjs 0.4.0
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs minor --dry-run
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const requested = args.find((argument) => !argument.startsWith("-"));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!requested) {
  fail("Usage: node scripts/release.mjs <version|major|minor|patch> [--dry-run]");
}

const packagePath = resolve(root, "package.json");
const versionPath = resolve(root, "src/version.ts");
const changelogPath = resolve(root, "CHANGELOG.md");

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const current = packageJson.version;

function nextVersion(from, bump) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bump)) return bump;
  const [major, minor, patch] = from.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return fail(`Not a version or bump keyword: ${bump}`);
}

const next = nextVersion(current, requested);
if (next === current) fail(`Already at ${current}.`);

// The CHANGELOG must describe the release before it is cut: an empty
// Unreleased section means the work was never written up.
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = /^## Unreleased\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(changelog);
if (!unreleased) fail("CHANGELOG.md has no `## Unreleased` section.");
if (!unreleased[1].trim())
  fail("The `## Unreleased` section is empty — write the release notes first.");

const today = new Date().toISOString().slice(0, 10);
const updates = [
  [packagePath, JSON.stringify({ ...packageJson, version: next }, null, 2) + "\n"],
  [
    versionPath,
    readFileSync(versionPath, "utf8").replace(
      /export const CLI_VERSION = "[^"]+";/,
      `export const CLI_VERSION = "${next}";`,
    ),
  ],
  [changelogPath, changelog.replace(/^## Unreleased$/m, `## Unreleased\n\n## ${next} — ${today}`)],
];

if (dryRun) {
  process.stdout.write(`${current} -> ${next} (dry run; nothing written)\n`);
  process.exit(0);
}

for (const [file, contents] of updates) writeFileSync(file, contents, "utf8");

// Keep the lockfile's own version fields in step without touching the tree.
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
  cwd: root,
  stdio: "inherit",
});

process.stdout.write(
  [
    `${current} -> ${next}`,
    "",
    "Next:",
    "  git add -A && git commit -m " + `"Release ${next}"`,
    `  git tag v${next} && git push --follow-tags`,
    "",
    "Pushing the tag runs .github/workflows/release.yml, which publishes to npm.",
    "",
  ].join("\n"),
);
