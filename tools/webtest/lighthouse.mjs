// Webtest quality gate: Lighthouse.
//   node lighthouse.mjs https://webtest-vulcanus.sunsato.com [--out=lighthouse]
//
// Accessibility, SEO, and best practices below 95 fail the gate; performance
// below 85 is a warning only (CI timing is noisy). Webtest is noindex and its
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
