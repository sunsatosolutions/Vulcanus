#!/usr/bin/env node
/**
 * Keep the landing page honest. The site is hand-written HTML with no build
 * step, so the things that drift silently are checked here instead:
 *
 * - the Content-Security-Policy allows each inline script and style by hash,
 *   not with 'unsafe-inline', and the hashes match the current files;
 * - no `style="…"` attribute or inline event handler sneaks back in, since
 *   neither can be allowed by a hash;
 * - nothing is loaded from another origin;
 * - the JSON-LD parses, states the package's version, and its FAQPage matches
 *   the visible FAQ question for question, answer for answer;
 * - the sitemap and security.txt dates are real, and security.txt has not
 *   expired;
 * - every indexable page has a title, a description under 160 characters, a
 *   canonical on the production domain, one h1, lang, and Open Graph tags, and
 *   is in the sitemap; nothing noindex is; internal links and llms.txt links
 *   resolve (the Deploy Flow Standard's site-profile checks).
 *
 *   node scripts/site-check.mjs           check, exit 1 on any problem
 *   node scripts/site-check.mjs --write   rewrite the CSP hashes in _headers
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "site");
const write = process.argv.includes("--write");
const PAGES = ["index.html", "404.html"];
const problems = [];
const warnings = [];

const read = (path) => readFileSync(resolve(site, path), "utf8");
const hash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// --- Inline code and its hashes ----------------------------------------------
const scriptHashes = new Set();
const styleHashes = new Set();

for (const page of PAGES) {
  const html = read(page);

  for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attributes = match[1] ?? "";
    // JSON-LD is data: browsers never execute it, so CSP does not apply.
    if (/type="application\/ld\+json"/.test(attributes)) continue;
    if (/\ssrc=/.test(attributes)) {
      problems.push(`${page}: external <script src> is not allowed`);
      continue;
    }
    scriptHashes.add(hash(match[2]));
  }
  for (const match of html.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g)) {
    styleHashes.add(hash(match[2]));
  }

  if (/\sstyle="/.test(html)) {
    problems.push(`${page}: style="…" attribute found; move it into the <style> block`);
  }
  if (/\son[a-z]+="/i.test(html)) {
    problems.push(`${page}: inline event handler found; attach it from the <script> block`);
  }
  for (const match of html.matchAll(
    /<(?:link|script|img|iframe|source)\b[^>]*\s(?:src|href)="([^"]+)"/g,
  )) {
    const url = match[1];
    const tag = match[0];
    // Outbound navigation links are fine; loaded resources must be same-origin.
    if (/^<link\b/.test(tag) && /rel="(canonical|alternate)"/.test(tag)) continue;
    if (/^https?:\/\//.test(url) || url.startsWith("//")) {
      problems.push(`${page}: loads a resource from another origin: ${url}`);
    }
  }
}

const headersPath = resolve(site, "_headers");
let headers = readFileSync(headersPath, "utf8");
const cspLine = /^(\s*Content-Security-Policy:\s*)(.+)$/m.exec(headers);
if (!cspLine) {
  problems.push("_headers: no Content-Security-Policy line");
} else {
  const expected = (directive, hashes) =>
    `${directive} 'self' ${[...hashes].sort().join(" ")}`.trim();
  let policy = cspLine[2];
  const replaceDirective = (directive, hashes) => {
    const pattern = new RegExp(`${directive} [^;]*`);
    if (!pattern.test(policy)) {
      problems.push(`_headers: CSP has no ${directive}`);
      return;
    }
    policy = policy.replace(pattern, expected(directive, hashes));
  };
  replaceDirective("script-src", scriptHashes);
  replaceDirective("style-src", styleHashes);

  if (write) {
    headers = headers.replace(cspLine[0], `${cspLine[1]}${policy}`);
    writeFileSync(headersPath, headers);
    process.stdout.write(
      `CSP updated: ${scriptHashes.size} script hash(es), ${styleHashes.size} style hash(es)\n`,
    );
  } else if (policy !== cspLine[2]) {
    problems.push("_headers: CSP hashes do not match the pages; run `npm run site:csp`");
  }
  if (cspLine[2].includes("'unsafe-inline'")) {
    problems.push("_headers: CSP still allows 'unsafe-inline'");
  }
}

// --- Structured data -----------------------------------------------------------
const index = read("index.html");
const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(index);
let graph = [];
try {
  graph = JSON.parse(ld?.[1] ?? "")["@graph"] ?? [];
} catch (error) {
  problems.push(`index.html: JSON-LD does not parse (${error.message})`);
}

const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const software = graph.find((node) => node["@type"] === "SoftwareApplication");
if (software?.softwareVersion !== packageVersion) {
  problems.push(
    `index.html: softwareVersion is ${software?.softwareVersion}, package.json is ${packageVersion}`,
  );
}

const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const visible = [...index.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(
  (match) => ({ question: plain(match[1]), answer: plain(match[2]) }),
);
const structured = (graph.find((node) => node["@type"] === "FAQPage")?.mainEntity ?? []).map(
  (entry) => ({ question: entry.name, answer: entry.acceptedAnswer?.text }),
);
if (visible.length !== structured.length) {
  problems.push(
    `FAQ: ${visible.length} visible question(s), ${structured.length} in FAQPage JSON-LD`,
  );
}
visible.forEach((entry, position) => {
  const twin = structured[position];
  if (!twin) return;
  if (entry.question !== twin.question) {
    problems.push(
      `FAQ ${position + 1}: question differs — "${entry.question}" vs "${twin.question}"`,
    );
  } else if (entry.answer !== twin.answer) {
    problems.push(`FAQ ${position + 1} ("${entry.question}"): answer differs from FAQPage JSON-LD`);
  }
});

// --- Search and agent readiness (Deploy Flow Standard, site profile) ------------
const ORIGIN = "https://vulcanus.sunsato.com";
const attribute = (html, pattern) => new RegExp(pattern).exec(html)?.[1];
const fileFor = (path) => resolve(site, path === "/" ? "index.html" : `.${path}`);
const exists = (path) => {
  try {
    readFileSync(fileFor(path));
    return true;
  } catch {
    return false;
  }
};

const sitemapPaths = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => {
  const url = new URL(match[1].trim());
  if (url.origin !== ORIGIN) problems.push(`sitemap.xml: ${url.href} is not on ${ORIGIN}`);
  return url.pathname;
});
if (
  !/^<\?xml[^>]*\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(
    read("sitemap.xml"),
  )
) {
  problems.push("sitemap.xml: not a sitemaps.org <urlset>");
}

for (const page of PAGES) {
  const html = read(page);
  const robots = attribute(html, /<meta name="robots" content="([^"]*)"/) ?? "";
  const path = page === "index.html" ? "/" : `/${page}`;
  if (robots.includes("noindex")) {
    if (sitemapPaths.includes(path)) problems.push(`sitemap.xml lists ${path}, which is noindex`);
    continue;
  }
  if (!sitemapPaths.includes(path)) problems.push(`${page}: indexable but not in sitemap.xml`);
  if (!attribute(html, /<html lang="([^"]+)"/)) problems.push(`${page}: <html> has no lang`);
  if (!attribute(html, /<title>([^<]+)<\/title>/)) problems.push(`${page}: no <title>`);
  const description = attribute(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  if (!description) problems.push(`${page}: no meta description`);
  else if (description.length >= 160) {
    problems.push(`${page}: meta description is ${description.length} characters (limit 159)`);
  }
  const canonical = attribute(html, /<link rel="canonical" href="([^"]+)"/);
  if (canonical !== `${ORIGIN}${path}`) {
    problems.push(`${page}: canonical is ${canonical}, expected ${ORIGIN}${path}`);
  }
  const h1 = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1 !== 1) problems.push(`${page}: ${h1} <h1> elements, expected one`);
  for (const property of ["og:title", "og:description", "og:url", "og:image"]) {
    if (!new RegExp(`<meta\\s+property="${property}"`).test(html)) {
      problems.push(`${page}: no ${property}`);
    }
  }
}

// Internal links resolve: same-site paths to a file, fragments to an id.
for (const page of PAGES) {
  const html = read(page);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith("#")) {
      if (href.length > 1 && !ids.has(href.slice(1))) {
        problems.push(`${page}: link ${href} has no matching id`);
      }
    } else if (href.startsWith("/") || href.startsWith(`${ORIGIN}/`)) {
      const path = new URL(href, ORIGIN).pathname;
      if (!exists(path)) problems.push(`${page}: link ${href} points to no file in site/`);
    }
  }
}

// llms.txt: same-site links resolve in site/, repository links to a committed file.
const llms = read("llms.txt");
if (!llms.startsWith("# ")) problems.push("llms.txt: does not start with an H1");
const generated = new Set(["/llms-full.txt"]); // written by scripts/site-build.mjs
for (const match of llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
  const url = new URL(match[1]);
  if (url.origin === ORIGIN) {
    if (!exists(url.pathname) && !generated.has(url.pathname)) {
      problems.push(`llms.txt: ${url.href} points to no file in site/`);
    }
  } else if (url.host === "raw.githubusercontent.com") {
    const file = url.pathname.split("/").slice(4).join("/");
    try {
      readFileSync(resolve(root, file));
    } catch {
      problems.push(`llms.txt: ${url.href} points to no committed file`);
    }
  }
}
if (!llms.includes(`${ORIGIN}/llms-full.txt`)) problems.push("llms.txt: no link to llms-full.txt");

// --- Dates ---------------------------------------------------------------------
const isDate = (value) => !Number.isNaN(Date.parse(value));
for (const match of read("sitemap.xml").matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
  if (!isDate(match[1])) problems.push(`sitemap.xml: lastmod "${match[1]}" is not a date`);
}
const expires = /^Expires:\s*(.+)$/m.exec(read(".well-known/security.txt"))?.[1];
if (!expires || !isDate(expires)) {
  problems.push("security.txt: Expires is missing or not a date");
} else {
  const days = (Date.parse(expires) - Date.now()) / 86_400_000;
  if (days < 0) problems.push(`security.txt: expired on ${expires}`);
  // A warning, not a failure: this gate runs on every deploy, and an unrelated
  // fix should not be blocked by a date a month away.
  else if (days < 30) warnings.push(`security.txt: expires in ${Math.floor(days)} day(s)`);
}

for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
if (problems.length) {
  process.stderr.write(`site check failed:\n${problems.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
if (!write)
  process.stdout.write(
    `site check passed: ${PAGES.length} pages, FAQ ${visible.length}/${structured.length}\n`,
  );
