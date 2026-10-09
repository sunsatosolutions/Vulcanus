// Webtest quality gate: responsive layout and accessibility.
//   node responsive.mjs https://webtest-vulcanus.sunsato.com [--shots=screenshots]
//
// - every sitemap URL (host rewritten to webtest: the webtest sitemap lists
//   production URLs) returns 200 and opens at 375, 768, and 1440 px with no
//   horizontal overflow
// - axe (WCAG 2.1 A/AA) at 1440 px: "serious" and "critical" violations fail
//   the gate, the rest are warnings
// - full-page screenshots for the approver (deploy.yml uploads the folder)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) || "").replace(/\/$/, "");
const shots = (args.find((a) => a.startsWith("--shots=")) || "--shots=screenshots").split("=")[1];
if (!base) {
  console.error("usage: node responsive.mjs <origin> [--shots=folder]");
  process.exit(2);
}

const WIDTHS = [375, 768, 1440];
const xml = await (await fetch(`${base}/sitemap.xml`)).text();
const paths = [
  ...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].trim()).pathname)),
];
if (!paths.length) throw new Error("the sitemap lists no URL");
mkdirSync(shots, { recursive: true });

const failures = [];
const warnings = [];
const browser = await chromium.launch();

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of paths) {
    const response = await page.goto(base + path, { waitUntil: "load" });
    if (!response || response.status() !== 200) {
      failures.push(`${path} @${width}: ${response?.status()}`);
      continue;
    }
    // Horizontal overflow: the document is wider than the viewport (1 px rounding allowed).
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= doc.clientWidth + 1) return null;
      const el = [...document.querySelectorAll("body *")].find(
        (e) => e.getBoundingClientRect().right > doc.clientWidth + 1,
      );
      const name = el
        ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`
        : "?";
      return `${doc.scrollWidth}px > ${doc.clientWidth}px (${name})`;
    });
    if (overflow) failures.push(`${path} @${width}: horizontal overflow ${overflow}`);

    const file = `${shots}/${width}${path === "/" ? "-home" : path.replaceAll("/", "-")}.png`;
    await page.screenshot({ path: file, fullPage: true });

    if (width === 1440) {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        const message = `${path}: axe ${v.id} (${v.impact}, ${v.nodes.length} nodes) ${v.help}`;
        if (v.impact === "serious" || v.impact === "critical") failures.push(message);
        else warnings.push(message);
      }
    }
  }
  for (const error of errors) failures.push(`@${width}: script error: ${error}`);
  await context.close();
  console.log(`${width}px: ${paths.length} page(s)`);
}
await browser.close();

for (const w of warnings) console.warn(`  ! ${w}`);
if (failures.length) {
  console.error(`\nresponsive / axe: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `responsive and axe passed: ${paths.length} page(s) × ${WIDTHS.length} widths, screenshots in ${shots}/`,
);
