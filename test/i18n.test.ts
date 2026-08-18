import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MESSAGE_KEYS,
  MESSAGE_PARAMETERS,
  MESSAGES,
  type Locale,
  type Messages,
} from "../src/i18n.js";
import { readFileSync } from "node:fs";

const LOCALES = Object.keys(MESSAGES) as Locale[];

/**
 * Sample arguments for message functions, keyed by arity. Every function in
 * `Messages` takes strings and numbers only, so generic samples are enough to
 * prove the function renders without throwing and produces real text.
 */
const SAMPLE_ARGS: unknown[] = ["Sample", 3, ["a.md", "b.md"]];

function render(value: Messages[keyof Messages]): string {
  if (typeof value === "string") return value;
  const fn = value as (...args: unknown[]) => string;
  return fn(...SAMPLE_ARGS.slice(0, fn.length));
}

describe("i18n messages", () => {
  test("all locales expose the same keys", () => {
    const [first, ...rest] = LOCALES;
    const reference = Object.keys(MESSAGES[first]).sort();
    for (const locale of rest) {
      assert.deepEqual(Object.keys(MESSAGES[locale]).sort(), reference);
    }
  });

  for (const locale of LOCALES) {
    test(`${locale}: every message renders to non-empty text`, () => {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        const text = render(value as Messages[keyof Messages]);
        assert.equal(typeof text, "string", `${locale}.${key} must render a string`);
        assert.ok(text.trim().length > 0, `${locale}.${key} must not be empty`);
      }
    });

    test(`${locale}: string and function kinds match across locales`, () => {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        const reference = MESSAGES[LOCALES[0]][key as keyof Messages];
        assert.equal(
          typeof value,
          typeof reference,
          `${locale}.${key} must be a ${typeof reference} like every other locale`,
        );
      }
    });
  }
});

/**
 * The catalogs are data now, and data can be edited by someone who never runs
 * the CLI. These are the failures that produces: a key dropped from one file, a
 * placeholder translated away, a template that keeps a name the code no longer
 * passes. Each one reaches a user as a broken prompt, so each one is a test.
 */
describe("locale catalogs", () => {
  const catalogs = new Map<Locale, Record<string, string>>(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), "utf8")),
    ]),
  );

  for (const [locale, catalog] of catalogs) {
    test(`${locale}.json carries every key and nothing extra`, () => {
      assert.deepEqual(Object.keys(catalog).sort(), [...MESSAGE_KEYS].sort());
    });

    test(`${locale}.json keeps every placeholder its entry is given`, () => {
      for (const [key, names] of Object.entries(MESSAGE_PARAMETERS)) {
        const template = catalog[key];
        for (const name of names) {
          assert.ok(
            template.includes(`{${name}}`),
            `${locale}.${key} drops {${name}}; the value would never be shown`,
          );
        }
      }
    });

    test(`${locale}.json has no placeholder the code will not fill`, () => {
      for (const [key, template] of Object.entries(catalog)) {
        const used = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
        const known = MESSAGE_PARAMETERS[key] ?? [];
        for (const name of used) {
          assert.ok(
            known.includes(name),
            `${locale}.${key} writes {${name}}, which nothing passes; it would print literally`,
          );
        }
      }
    });
  }

  test("rendering leaves no placeholder behind", () => {
    for (const [locale, messages] of Object.entries(MESSAGES) as [Locale, Messages][]) {
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value !== "function") continue;
        const names = MESSAGE_PARAMETERS[key];
        const args = names.map((name) =>
          name === "files" && key === "aiHandoffSummary" ? ["a.md"] : "x",
        );
        const text = (value as (...a: unknown[]) => string)(...args);
        assert.equal(
          /\{\w+\}/.test(text),
          false,
          `${locale}.${key} still contains a placeholder after rendering: ${text}`,
        );
      }
    }
  });
});
