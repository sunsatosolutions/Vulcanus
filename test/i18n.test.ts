import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGES, type Locale, type Messages } from "../src/i18n.js";

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
        if (typeof value === "function" && typeof reference === "function") {
          assert.equal(
            (value as (...args: unknown[]) => string).length,
            (reference as (...args: unknown[]) => string).length,
            `${locale}.${key} must take the same arguments in every locale`,
          );
        }
      }
    });
  }
});
