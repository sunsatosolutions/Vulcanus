#!/usr/bin/env node
/**
 * Smoke-test a deployed copy of the site against the package it was deployed
 * from: the page is byte-for-byte the packaged one, the headers in `_headers`
 * are what browsers actually get, every file crawlers and agents look for
 * answers, and the environment behaves like the one it claims to be.
 *
 *   --origin <url>     where to check (default https://vulcanus.sunsato.com)
 *   --dir <path>       the packaged copy it should serve
 *                      (default out/package/<expect>)
 *   --expect <env>     production (default) or staging
 *   --sha <commit>     /version.json must report this commit
 *   --wait <seconds>   poll until /version.json reports --sha
 *
 * production: indexable, robots.txt open, AI crawlers get 200 (a 403 means
 * Cloudflare's AI-bot blocking is on), http:// redirects permanently.
 * staging: X-Robots-Tag and the page say noindex, robots.txt disallows all.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const ORIGIN = option("origin", "https://vulcanus.sunsato.com").replace(/\/$/, "");
const expect = option("expect", "production");
const dir = resolve(root, option("dir", `out/package/${expect}`));
const expectedSha = option("sha", "");
const waitSeconds = Number(option("wait", "0"));

if (!["production", "staging"].includes(expect)) {
  process.stderr.write(`--expect must be production or staging, not "${expect}"\n`);
  process.exit(2);
}
if (!existsSync(resolve(dir, "index.html"))) {
  process.stderr.write(`${dir} has no index.html — run \`npm run site:build\` first\n`);
  process.exit(2);
}

const digest = (text) => createHash("sha256").update(text).digest("hex");
const local = (path) => readFileSync(resolve(dir, path), "utf8");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(path, userAgent = "vulcanus-site-check") {
  const response = await fetch(`${ORIGIN}${path}`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache", "user-agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const problems = [];

// --- The deployed commit ---------------------------------------------------------
async function version() {
  const response = await get("/version.json").catch(() => null);
  if (response?.status !== 200) return null;
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}
const deadline = Date.now() + waitSeconds * 1000;
let deployed = await version();
while (expectedSha && deployed?.sha !== expectedSha && Date.now() < deadline) {
  process.stdout.write(`${ORIGIN} does not serve ${expectedSha.slice(0, 7)} yet; waiting…\n`);
  await sleep(10_000);
  deployed = await version();
}
if (!deployed) problems.push("/version.json is missing or not JSON");
else {
  if (expectedSha && deployed.sha !== expectedSha) {
    problems.push(`/version.json reports ${deployed.sha}, expected ${expectedSha}`);
  }
  if (deployed.env !== expect) problems.push(`/version.json env is ${deployed.env}, not ${expect}`);
}

// --- The page is the packaged page ----------------------------------------------
const page = await get("/");
if (page.status !== 200) problems.push(`/ returned ${page.status}`);
if (digest(page.body) !== digest(local("index.html"))) {
  problems.push(`/ differs from ${dir}/index.html`);
}

// --- Headers are the ones _headers declares -------------------------------------
const declared = new Map();
const globalRule = /^\/\*\n((?:[ \t]+.+\n?)+)/m.exec(local("_headers"));
for (const line of (globalRule?.[1] ?? "").split("\n")) {
  const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
  if (match) declared.set(match[1].toLowerCase(), match[2].trim());
}
for (const [name, value] of declared) {
  const live = page.headers.get(name);
  if (live !== value) problems.push(`header ${name}: live "${live ?? "(missing)"}" ≠ _headers`);
}

// --- Everything crawlers and agents ask for ------------------------------------
const indexNowKey = readdirSync(dir).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
const endpoints = [
  ["/robots.txt", "text/plain", expect === "production" ? "Sitemap:" : "Disallow: /"],
  ["/sitemap.xml", "xml", "<urlset"],
  ["/llms.txt", "text/markdown", "# Vulcanus"],
  ["/llms-full.txt", "text/markdown", "# Vulcanus"],
  ["/.well-known/security.txt", "text/plain", "Contact:"],
  ["/favicon.ico", "image/", null],
  ["/favicon.svg", "image/svg+xml", "<svg"],
  ["/apple-touch-icon.png", "image/png", null],
  ["/og.png", "image/png", null],
  ...(indexNowKey ? [[`/${indexNowKey}`, "text/plain", indexNowKey.replace(".txt", "")]] : []),
];
for (const [path, type, marker] of endpoints) {
  const response = await get(path);
  if (response.status !== 200) {
    problems.push(`${path} returned ${response.status}`);
    continue;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes(type)) problems.push(`${path}: content-type "${contentType}"`);
  if (marker && !response.body.includes(marker)) problems.push(`${path}: missing "${marker}"`);
}

const missing = await get("/this-page-does-not-exist");
if (missing.status !== 404) problems.push(`unknown path returned ${missing.status}, not 404`);
if (!missing.body.includes("noindex")) problems.push("404 page is not marked noindex");

if (ORIGIN.startsWith("https://")) {
  const insecure = await fetch(ORIGIN.replace("https://", "http://"), {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (insecure && ![301, 308].includes(insecure.status)) {
    problems.push(`http:// returned ${insecure.status}, not a permanent redirect to https`);
  }
}

// --- The environment behaves like itself ----------------------------------------
const robotsHeader = page.headers.get("x-robots-tag") ?? "";
const robotsMeta = /<meta name="robots" content="([^"]*)"/.exec(page.body)?.[1] ?? "";
if (expect === "staging") {
  if (!robotsHeader.includes("noindex")) problems.push("webtest: no X-Robots-Tag noindex");
  if (!robotsMeta.includes("noindex")) problems.push("webtest: page is not marked noindex");
} else {
  if (robotsHeader.includes("noindex")) problems.push(`live: X-Robots-Tag is "${robotsHeader}"`);
  if (robotsMeta.includes("noindex")) problems.push("live: page is marked noindex");
  const robots = await get("/robots.txt");
  if (/^Disallow:\s*\/\s*$/m.test(robots.body)) problems.push("live: robots.txt disallows all");
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot"]) {
    const response = await get("/", `Mozilla/5.0 (compatible; ${bot}/1.0)`);
    if (response.status !== 200) problems.push(`${bot} got ${response.status} on /`);
  }
}

if (problems.length) {
  process.stderr.write(
    `site check failed for ${ORIGIN} (${expect}):\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `site check passed: ${ORIGIN} serves ${deployed.sha.slice(0, 7)} as ${expect}\n`,
);
