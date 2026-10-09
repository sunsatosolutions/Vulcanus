#!/usr/bin/env node
/**
 * Package site/ for a release: one staging copy and one production copy, built
 * together from the same commit, so what goes live is exactly what was tested
 * on webtest except for the lines that keep webtest out of search engines.
 *
 *   out/package/production   site/ as committed + version.json + llms-full.txt
 *   out/package/staging      the same, plus noindex everywhere:
 *                            robots.txt disallows all, every HTML page carries
 *                            <meta name="robots" content="noindex">, and every
 *                            response gets X-Robots-Tag: noindex
 *
 * version.json reports the commit (`git rev-parse HEAD`, not GITHUB_SHA, which
 * is the dispatching commit inside a called workflow), the build time, and the
 * environment the copy is for. Canonicals and the sitemap keep the production
 * domain in both copies.
 *
 *   node scripts/site-build.mjs                  build both copies
 *   node scripts/site-build.mjs --sha <commit>   use this commit instead of HEAD
 */
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "site");
const out = resolve(root, "out", "package");
const args = process.argv.slice(2);
const shaFlag = args.indexOf("--sha");
const sha =
  shaFlag === -1
    ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    : args[shaFlag + 1];
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
  process.stderr.write(`site build: "${sha}" is not a full commit SHA\n`);
  process.exit(1);
}
const built = new Date().toISOString();

const htmlFiles = (dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".html"));

// llms-full.txt is the README of the same commit, so it can never drift from
// the documentation it stands for.
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const llmsFull = `${readme.trimEnd()}\n`;

function copy(env) {
  const target = join(out, env);
  // Wrangler's own state, if a local `wrangler dev` ever ran inside site/.
  cpSync(site, target, { recursive: true, filter: (path) => !path.includes(".wrangler") });
  writeFileSync(join(target, "llms-full.txt"), llmsFull);
  writeFileSync(join(target, "version.json"), `${JSON.stringify({ sha, built, env }, null, 2)}\n`);
  return target;
}

rmSync(out, { recursive: true, force: true });
copy("production");
const staging = copy("staging");

writeFileSync(
  join(staging, "robots.txt"),
  "# Webtest: a release candidate under review. Not for indexing.\nUser-agent: *\nDisallow: /\n",
);

for (const name of htmlFiles(staging)) {
  const path = join(staging, name);
  const html = readFileSync(path, "utf8");
  const robots = /<meta name="robots" content="[^"]*"\s*\/?>/;
  const noindex = '<meta name="robots" content="noindex, nofollow" />';
  const next = robots.test(html)
    ? html.replace(robots, noindex)
    : html.replace(/<head>/, `<head>\n    ${noindex}`);
  if (next === html && !html.includes(noindex)) {
    process.stderr.write(`site build: could not mark ${name} noindex\n`);
    process.exit(1);
  }
  writeFileSync(path, next);
}

const headersPath = join(staging, "_headers");
const headers = readFileSync(headersPath, "utf8");
const globalRule = /^\/\*\n/m;
if (!globalRule.test(headers)) {
  process.stderr.write("site build: _headers has no /* rule to add X-Robots-Tag to\n");
  process.exit(1);
}
writeFileSync(headersPath, headers.replace(globalRule, "/*\n  X-Robots-Tag: noindex, nofollow\n"));

process.stdout.write(`site build: ${sha.slice(0, 7)} → out/package/{production,staging}\n`);
