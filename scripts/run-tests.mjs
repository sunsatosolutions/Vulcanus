#!/usr/bin/env node
/**
 * Run the test suite with the file list expanded here rather than by the shell.
 *
 * `node --test test/*.test.ts` works in bash but not in PowerShell, which does
 * not expand globs — that is what turned the Windows CI legs red. Expanding the
 * list here keeps one command that behaves the same in every shell.
 *
 *   node scripts/run-tests.mjs                          # plain run
 *   node scripts/run-tests.mjs --experimental-test-coverage
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(root, "test");

const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join(testDir, name));

if (files.length === 0) {
  process.stderr.write(`No *.test.ts files in ${testDir}\n`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2), "--import", "tsx", ...files],
  { cwd: root, stdio: "inherit" },
);

process.exit(result.status ?? 1);
