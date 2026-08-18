import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { generateFiles } from "../src/generate/index.js";
import { headingVariants, noteText, type NoteCatalog } from "../src/generate/text.js";
import { LOCALES, type Locale } from "../src/i18n.js";
import { manifest, project } from "./helpers.js";

function catalog(locale: Locale): NoteCatalog {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/notes/${locale}.json`, import.meta.url), "utf8"),
  );
}

const CATALOGS = new Map<Locale, NoteCatalog>(LOCALES.map((locale) => [locale, catalog(locale)]));
const EN = CATALOGS.get("en")!;

/** Every `t("key")` the generators actually ask for. */
function referencedKeys(): Set<string> {
  const dir = new URL("../src/generate/", import.meta.url);
  const keys = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) keys.add(match[1]);
  }
  return keys;
}

/** Every `t.heading("Name")` the generators ask for. */
function referencedHeadings(): Set<string> {
  const dir = new URL("../src/generate/", import.meta.url);
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(/\bt\.heading(?:Text)?\("([^"]+)"\)/g)) names.add(match[1]);
  }
  return names;
}

describe("generated-note catalogs", () => {
  test("every key the generators ask for exists in English", () => {
    const missing = [...referencedKeys()].filter((key) => !(key in EN.text));
    assert.deepEqual(missing, [], "a generator would throw asking for these");
  });

  test("every heading the generators ask for exists in English", () => {
    const missing = [...referencedHeadings()].filter((name) => !(name in EN.headings));
    assert.deepEqual(missing, [], "these would fall back to their own English name");
  });

  test("English carries no entry nothing asks for", () => {
    const used = referencedKeys();
    const orphans = Object.keys(EN.text).filter((key) => !used.has(key));
    assert.deepEqual(orphans, [], "dead entries a translator would waste time on");
  });

  for (const [locale, entries] of CATALOGS) {
    test(`${locale}: same keys as English`, () => {
      assert.deepEqual(Object.keys(entries.text).sort(), Object.keys(EN.text).sort());
      assert.deepEqual(Object.keys(entries.headings).sort(), Object.keys(EN.headings).sort());
    });

    test(`${locale}: keeps every placeholder English has`, () => {
      for (const [key, english] of Object.entries(EN.text)) {
        const names = [...english.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
        for (const name of new Set(names)) {
          assert.ok(
            entries.text[key].includes(`{${name}}`),
            `${locale}.${key} drops {${name}}; the value would never appear`,
          );
        }
      }
    });

    test(`${locale}: invents no placeholder the generator will not fill`, () => {
      for (const [key, translated] of Object.entries(entries.text)) {
        const known = new Set([...EN.text[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
        for (const match of translated.matchAll(/\{(\w+)\}/g)) {
          assert.ok(
            known.has(match[1]),
            `${locale}.${key} writes {${match[1]}}, which nothing passes; it would print literally`,
          );
        }
      }
    });
  }
});

describe("section headings across languages", () => {
  test("a vault's own heading comes first, English stays accepted", () => {
    for (const locale of LOCALES) {
      const variants = headingVariants("Core Files", locale);
      assert.equal(variants[0], `## ${CATALOGS.get(locale)!.headings["Core Files"]}`);
      assert.ok(
        variants.includes(`## ${EN.headings["Core Files"]}`),
        "a vault written before the headings were translated must still validate",
      );
    }
  });

  test("an unknown section falls back to its own name rather than vanishing", () => {
    assert.deepEqual(headingVariants("Nothing Named This", "en"), ["## Nothing Named This"]);
  });
});

describe("generated notes follow the vault's language", () => {
  const input = (language: Locale) =>
    manifest({
      vault: { ...manifest().vault, language },
      projects: [project("northwind", "Northwind")],
    });

  test("a missing translation falls back to English instead of an empty note", () => {
    const text = noteText("de");
    // Whatever `de` carries, asking for a key must produce text, never "".
    for (const key of Object.keys(EN.text).slice(0, 25)) {
      assert.ok(
        text(key, { name: "X", parentName: "Y" }).trim().length > 0,
        `${key} rendered empty`,
      );
    }
  });

  test("every locale generates a complete vault", () => {
    for (const locale of LOCALES) {
      const { files } = generateFiles(input(locale));
      assert.ok(files.length > 0, `${locale} generated nothing`);
      for (const file of files) {
        assert.ok(file.content.trim().length > 0, `${locale} wrote an empty ${file.path}`);
        assert.equal(
          /\{(name|parentName|vault)\}/.test(file.content),
          false,
          `${locale} left a placeholder unfilled in ${file.path}`,
        );
      }
    }
  });
});
