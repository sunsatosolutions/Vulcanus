import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskSecrets } from "../src/secrets/detector.js";
import { recallFixtures } from "./recall-fixtures.js";

const MIN_RECALL = 0.95;

describe("Blackbar recall", () => {
  const fixtures = recallFixtures();

  it("has at least 30 patterns across every named family", () => {
    assert.ok(fixtures.length >= 30, `only ${fixtures.length} fixtures`);
    const families = new Set(fixtures.map((f) => f.family));
    for (const family of [
      "sk",
      "github",
      "aws",
      "slack",
      "jwt",
      "bearer",
      "password-unquoted",
      "password-quoted",
      "password-escaped",
      "conn-string",
      "entropy",
    ])
      assert.ok(families.has(family), family);
    for (const f of fixtures) assert.ok(f.line.includes(f.value), f.id);
  });

  it(`catches at least ${MIN_RECALL * 100}% and never prints a value`, () => {
    const missed: string[] = [];
    for (const f of fixtures) {
      const { text, findings } = maskSecrets(f.line, f.id);
      // Caught = something was found and the value no longer appears in the masked line.
      if (findings.length === 0 || text.includes(f.value)) missed.push(f.id);
    }
    const caught = fixtures.length - missed.length;
    const rate = (caught / fixtures.length) * 100;
    // The shape of each miss, never its value.
    const gaps = missed.map((id) => {
      const f = fixtures.find((x) => x.id === id)!;
      return `${id}: ${f.line.split(f.value).join("<VALUE>")}`;
    });
    console.log(`Blackbar recall: ${caught}/${fixtures.length} (${rate.toFixed(1)}%)`);
    if (gaps.length) console.log(`Not caught:\n  ${gaps.join("\n  ")}`);
    assert.ok(
      rate >= MIN_RECALL * 100,
      `recall ${rate.toFixed(1)}% is below ${MIN_RECALL * 100}%; not caught:\n  ${gaps.join("\n  ")}`,
    );
  });
});
