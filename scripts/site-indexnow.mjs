#!/usr/bin/env node
/**
 * Tell search engines about changed pages, and only those.
 *
 *   node scripts/site-indexnow.mjs --changed <dir>
 *       Before a live deploy: print the path of every indexable URL (the
 *       sitemap's, plus /llms.txt) whose file in <dir> — the production copy
 *       about to go live — differs from what production serves now.
 *   node scripts/site-indexnow.mjs <path>...
 *       After the deploy: submit those paths to IndexNow. No paths, no request.
 *
 * IndexNow is a hint, not a gate: a refused submission is reported, never
 * failed on, because the deploy itself is fine.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://vulcanus.sunsato.com";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const digest = (text) => createHash("sha256").update(text).digest("hex");

if (args[0] === "--changed") {
  const dir = resolve(root, args[1] ?? "out/site");
  const sitemap = readFileSync(resolve(dir, "sitemap.xml"), "utf8");
  const paths = [
    ...[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].trim()).pathname),
    "/llms.txt",
  ];
  for (const path of new Set(paths)) {
    const file = resolve(dir, path === "/" ? "index.html" : `.${path}`);
    const next = existsSync(file) ? readFileSync(file, "utf8") : "";
    const live = await fetch(`${ORIGIN}${path}`, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(20_000),
    })
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "");
    if (digest(next) !== digest(live)) process.stdout.write(`${path}\n`);
  }
  process.exit(0);
}

const paths = args.filter(Boolean);
if (!paths.length) {
  process.stdout.write("IndexNow: no changed URL, nothing sent\n");
  process.exit(0);
}
const keyFile = readdirSync(resolve(root, "site")).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) {
  process.stderr.write("IndexNow: no key file in site/; nothing sent\n");
  process.exit(0);
}
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(ORIGIN).host,
    key: keyFile.replace(".txt", ""),
    keyLocation: `${ORIGIN}/${keyFile}`,
    urlList: paths.map((path) => `${ORIGIN}${path}`),
  }),
  signal: AbortSignal.timeout(20_000),
}).catch((error) => ({ status: `failed (${error.message})` }));
// 200 and 202 both mean accepted.
process.stdout.write(`IndexNow: ${response.status} for ${paths.join(" ")}\n`);
