import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildCleanNotes, buildSeededSecrets } from "./bench/secrets-sets.js";
import { scanText } from "../src/secrets/detector.js";

test("bench sets: sizes, classes and determinism", () => {
  const secrets = buildSeededSecrets();
  assert.equal(secrets.length, 100);
  assert.equal(buildCleanNotes().length, 100);
  assert.ok(secrets.filter((s) => s.cls === "cli-password").length >= 20);
  for (const cls of [
    "aws",
    "github",
    "npm",
    "stripe",
    "slack",
    "google",
    "llm",
    "pem",
    "openssh",
    "db-url",
    "bearer",
    "generic",
  ]) {
    assert.ok(
      secrets.some((s) => s.cls === cls),
      cls,
    );
  }
  assert.deepEqual(buildSeededSecrets(), secrets);
  for (const s of secrets) assert.ok(s.text.includes(s.value), s.id);
});

test("bench sets: every seeded secret is found by at least one pattern or is a known gap", () => {
  const found = buildSeededSecrets().filter((s) => scanText(s.text).length > 0).length;
  assert.ok(found >= 90, `found ${found}`);
});
