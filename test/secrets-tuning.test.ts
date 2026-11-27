import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSecret, scanText } from "../src/secrets/detector.js";

// Values are built at run time; no token-shaped text sits in the repo.
const hex = (n: number) =>
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".repeat(2).slice(0, n);
const word = (...p: string[]) => p.join("-");

describe("secret detector tuning: kebab-case prose", () => {
  it("does not flag word-made values under a keyword", () => {
    assert.equal(hasSecret(`secret_rotation: ${word("rotate", "every", "90", "days")}`), false);
    assert.equal(
      hasSecret(`password_policy: ${word("min", "12", "chars", "with", "digits")}`),
      false,
    );
  });
  it("still flags a hyphenated value that is not words", () => {
    const v = ["a8Kd", "92Xz", "Q7vL", "m3Pw"].join("-");
    assert.equal(hasSecret(`api_key: ${v}`), true);
  });
});

describe("secret detector tuning: bearer in a template literal", () => {
  it("flags a bearer value after a backtick", () => {
    const t = ["a8Kd92Xz", "Q7vLm3Pw", "Zr5Tn1Yc"].join("");
    const f = scanText(`headers: { Authorization: \`Bearer ${t}\` }`);
    assert.deepEqual(
      f.map((x) => x.kind),
      ["bearer-token"],
    );
  });
  it("ignores a bearer placeholder in a template literal", () => {
    assert.equal(hasSecret("Authorization: `Bearer ${token}`"), false);
  });
});

describe("secret detector tuning: hex64", () => {
  it("flags 64 hex under a credential key", () => {
    assert.equal(hasSecret(`api_key: ${hex(64)}`), true);
    assert.equal(hasSecret(`db_password = "${hex(64)}"`), true);
  });
  it("spares 64 hex under a digest key", () => {
    assert.equal(hasSecret(`token_hash: ${hex(64)}`), false);
    assert.equal(hasSecret(`secret_sha256 = ${hex(64)}`), false);
    assert.equal(hasSecret(`sha256: ${hex(64)}`), false);
  });
  it("spares other hex lengths under a credential key", () => {
    assert.equal(hasSecret(`api_key: ${hex(40)}`), false);
  });
});
