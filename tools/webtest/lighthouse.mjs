// Webtest quality gate: Lighthouse.
//   node lighthouse.mjs https://webtest-vulcanus.sunsato.com [--out=lighthouse]
//
// Accessibility, SEO, and best practices below 95 fail the gate; performance
// below 85 is a warning only (CI timing is noisy).
//
// One console error is known and accepted: Cloudflare injects its zone-wide
// Web Analytics beacon into every page of the zone, and the site's CSP blocks
// it (the owner chose on 2026-10-01 to keep both as they are). When the only
// console errors and inspector issues are that beacon, best practices is
// scored without those two audits and a warning is printed instead; any other
// console error still fails the gate. Webtest is noindex and its
// robots.txt disallows everything on purpose, so the crawlability and
// robots.txt audits are skipped; the live smoke test checks both in production. HTML reports go to the
// folder (deploy.yml uploads it for the approver).
import { mkdirSync, writeFileSync } from "node:fs";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) || "").replace(/\/$/, "");
const out = (args.find((a) => a.startsWith("--out=")) || "--out=lighthouse").split("=")[1];
if (!base) {
  console.error("usage: node lighthouse.mjs <origin> [--out=folder]");
  process.exit(2);
}

const PATHS = ["/"];
const GATE = { accessibility: 0.95, seo: 0.95, "best-practices": 0.95 };
const BEACON = "static.cloudflareinsights.com";
const BEACON_AUDITS = ["errors-in-console", "inspector-issues"];

// True when every item an audit reports names the blocked analytics beacon.
const onlyBeacon = (audit) => {
  const items = audit?.details?.items ?? [];
  return items.length > 0 && items.every((item) => JSON.stringify(item).includes(BEACON));
};

// Best practices re-scored without the beacon audits, when those are its only cause.
function bestPractices(lhr) {
  const category = lhr.categories["best-practices"];
  const failing = BEACON_AUDITS.filter((id) => (lhr.audits[id]?.score ?? 1) < 1);
  if (!failing.length || !failing.every((id) => onlyBeacon(lhr.audits[id]))) {
    return { score: category.score, excused: false };
  }
  const refs = category.auditRefs.filter((ref) => ref.weight > 0 && !failing.includes(ref.id));
  const weight = refs.reduce((sum, ref) => sum + ref.weight, 0);
  const score =
    refs.reduce((sum, ref) => sum + (lhr.audits[ref.id].score ?? 1) * ref.weight, 0) / weight;
  return { score, excused: true };
}
const WARN = { performance: 0.85 };

mkdirSync(out, { recursive: true });
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox"],
});
const failures = [];
const warnings = [];
try {
  for (const path of PATHS) {
    const result = await lighthouse(base + path, {
      port: chrome.port,
      output: "html",
      logLevel: "error",
      onlyCategories: [...Object.keys(GATE), ...Object.keys(WARN)],
      skipAudits: ["is-crawlable", "robots-txt"],
    });
    const { categories } = result.lhr;
    writeFileSync(
      `${out}/${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}.html`,
      result.report,
    );
    console.log(
      `${path}: ${Object.entries(categories)
        .map(([k, c]) => `${k} ${Math.round(c.score * 100)}`)
        .join(", ")}`,
    );
    const bp = bestPractices(result.lhr);
    if (bp.excused) {
      warnings.push(
        `${path}: best-practices ${Math.round(categories["best-practices"].score * 100)} → ${Math.round(bp.score * 100)} without the blocked Cloudflare Web Analytics beacon (accepted)`,
      );
      categories["best-practices"].score = bp.score;
    }
    for (const [k, min] of Object.entries(GATE)) {
      if (categories[k].score < min) {
        const failed = Object.values(result.lhr.audits).filter(
          (a) =>
            a.score !== null &&
            a.score < 1 &&
            categories[k].auditRefs.some((r) => r.id === a.id && r.weight > 0),
        );
        failures.push(
          `${path}: ${k} ${Math.round(categories[k].score * 100)} < ${min * 100} (${failed.map((a) => a.id).join(", ")})`,
        );
      }
    }
    for (const [k, min] of Object.entries(WARN)) {
      if (categories[k].score < min) {
        warnings.push(`${path}: ${k} ${Math.round(categories[k].score * 100)} < ${min * 100}`);
      }
    }
  }
} finally {
  await chrome.kill();
}

for (const w of warnings) console.log(`::warning::Lighthouse ${w}`);
if (failures.length) {
  console.error(`\nLighthouse: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Lighthouse passed: ${PATHS.length} page(s)`);
