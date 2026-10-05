#!/usr/bin/env node
/**
 * Check the deployed landing page against the repository.
 *
 * Cloudflare Workers Builds deploys `site/` on every push to `main`; this is
 * the other half of that pipeline. It confirms the live page is the committed
 * one, that the security headers in `_headers` are what browsers actually get,
 * and that every file crawlers and agents look for answers.
 *
 *   node scripts/site-live-check.mjs              check once
 *   node scripts/site-live-check.mjs --wait 600   poll up to 600 s for the deploy
 *   node scripts/site-live-check.mjs --indexnow   also notify IndexNow when it passes
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.SITE_ORIGIN ?? "https://vulcanus.sunsato.com";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "site");
const args = process.argv.slice(2);
const waitFlag = args.indexOf("--wait");
const waitSeconds = waitFlag === -1 ? 0 : Number(args[waitFlag + 1] ?? 600);
const notify = args.includes("--indexnow");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const local = (path) => readFileSync(resolve(site, path), "utf8");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(path) {
  const response = await fetch(`${ORIGIN}${path}`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache", "user-agent": "vulcanus-site-check" },
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

// --- Wait until the live page is the committed page ----------------------------
const expected = sha(local("index.html"));
const deadline = Date.now() + waitSeconds * 1000;
let page = await get("/");
while (sha(page.body) !== expected && Date.now() < deadline) {
  process.stdout.write("live page does not match the repository yet; waiting for the deploy…\n");
  await sleep(15_000);
  page = await get("/");
}

const problems = [];
if (page.status !== 200) problems.push(`/ returned ${page.status}`);
if (sha(page.body) !== expected) {
  problems.push(
    waitSeconds
      ? `live / still differs from site/index.html after ${waitSeconds}s — did the Workers Build fail?`
      : "live / differs from site/index.html (not deployed yet, or the build failed)",
  );
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
const indexNowKey = readdirSync(site).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
const endpoints = [
  ["/robots.txt", "text/plain", "Sitemap:"],
  ["/sitemap.xml", "xml", "<urlset"],
  ["/llms.txt", "text/markdown", "# Vulcanus"],
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

const insecure = await fetch(ORIGIN.replace("https://", "http://"), { redirect: "manual" }).catch(
  () => null,
);
if (insecure && ![301, 308].includes(insecure.status)) {
  problems.push(`http:// returned ${insecure.status}, not a permanent redirect to https`);
}

if (problems.length) {
  process.stderr.write(`live site check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`live site check passed: ${ORIGIN} matches the repository\n`);

// --- Tell search engines the page changed --------------------------------------
if (notify) {
  if (!indexNowKey) {
    process.stderr.write("no IndexNow key file in site/; skipping notification\n");
    process.exit(0);
  }
  const key = indexNowKey.replace(".txt", "");
  const host = new URL(ORIGIN).host;
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${ORIGIN}/${indexNowKey}`,
      urlList: [`${ORIGIN}/`, `${ORIGIN}/llms.txt`],
    }),
  });
  // 200 and 202 both mean accepted; anything else is reported but does not fail
  // the run — the deploy itself is fine, and IndexNow is a hint, not a gate.
  process.stdout.write(`IndexNow: ${response.status}\n`);
}
