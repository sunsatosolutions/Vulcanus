/**
 * Fake secrets for the scanner tests. The repository is public, so no value
 * sits in a file whole: prefixes and bodies are assembled while the tests run,
 * which keeps push protection and other scanners quiet.
 */

export interface SecretFixture {
  name: string;
  type: string;
  level: "error" | "warning";
  /** The line as it would appear in a note. */
  line: string;
  /** The secret inside the line; must never reach scan output. */
  value: string;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Deterministic pseudo-random text; a fixed seed keeps failures reproducible. */
function body(length: number, seed: number, alphabet = ALPHABET): string {
  let state = seed * 2654435761 + 12345;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor(state / 65536) % alphabet.length];
  }
  return out;
}

const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const B64URL = `${ALPHABET}-_`;

function make(
  name: string,
  type: string,
  level: SecretFixture["level"],
  value: string,
  template: string,
): SecretFixture {
  return { name, type, level, value, line: template.replace("$V", value) };
}

export function positives(): SecretFixture[] {
  const out: SecretFixture[] = [];
  const add = (...args: Parameters<typeof make>) => out.push(make(...args));

  for (const [i, tpl] of ["OpenAI key: $V", "OPENAI_API_KEY=$V", "export KEY=$V # old"].entries()) {
    add(`api-key-${i}`, "api_key", "error", ["s", "k", "-", body(40, 10 + i)].join(""), tpl);
  }
  add("api-key-proj", "api_key", "error", `sk-${"pr"}oj-${body(48, 14, B64URL)}`, "key $V here");

  for (const [i, prefix] of [
    "gh" + "p_",
    "gh" + "o_",
    "gh" + "u_",
    "gh" + "s_",
    "gh" + "p_",
  ].entries()) {
    add(`github-${prefix}${i}`, "github_token", "error", prefix + body(36, 20 + i), "token: $V");
  }
  add(
    "github-pat",
    "github_token",
    "error",
    ["github", "_pat_", body(22, 30), "_", body(40, 31)].join(""),
    "$V",
  );
  add(
    "github-in-url",
    "github_token",
    "error",
    "gh" + "p_" + body(40, 32),
    "git clone https://$V@host.example/r.git",
  );

  for (let i = 0; i < 3; i++) {
    add(
      `aws-${i}`,
      "aws_access_key",
      "error",
      ["AK", "IA", body(16, 40 + i, UPPER_DIGITS)].join(""),
      "aws_access_key_id = $V",
    );
  }
  add("aws-asia", "aws_access_key", "error", "AS" + "IA" + body(16, 44, UPPER_DIGITS), "$V");

  for (let i = 0; i < 3; i++) {
    const prefix = i === 1 ? "xo" + "xp-" : "xo" + "xb-";
    add(
      `slack-${i}`,
      "slack_token",
      "error",
      `${prefix}${body(12, 50 + i, "0123456789")}-${body(24, 53 + i)}`,
      "SLACK_TOKEN=$V",
    );
  }

  for (let i = 0; i < 3; i++) {
    const jwt = [
      "ey" + "J" + body(20, 60 + i, B64URL),
      "ey" + "J" + body(30, 63 + i, B64URL),
      body(43, 66 + i, B64URL),
    ].join(".");
    add(`jwt-${i}`, "jwt", "error", jwt, "session $V expired");
  }

  for (let i = 0; i < 3; i++) {
    add(
      `bearer-${i}`,
      "bearer_token",
      "error",
      body(32, 70 + i),
      "curl -H 'Authorization: Bearer $V' https://api.example.test",
    );
  }

  for (const [i, tpl] of [
    "pass" + "word=$V",
    "pass" + "wd: $V",
    "Pass" + 'word: "$V"',
    "db_pass" + "word = $V",
  ].entries()) {
    add(`password-${i}`, "password", "error", body(10, 80 + i) + "9!", tpl);
  }

  for (let i = 0; i < 3; i++) {
    const scheme = ["postgres", "mysql", "https"][i];
    add(
      `connection-${i}`,
      "connection_password",
      "error",
      body(14, 90 + i),
      `${scheme}://app:$V@db.example.test:5432/main`,
    );
  }

  for (let i = 0; i < 4; i++) {
    add(`entropy-${i}`, "high_entropy", "warning", body(40 + i * 8, 100 + i), "signing blob $V ok");
  }
  return out;
}

/** Lines a scanner must leave alone, each close to something it looks for. */
export function negatives(): string[] {
  const sha = body(40, 200, "0123456789abcdef");
  return [
    "# Deploy notes",
    "Authorization: Bearer <token>",
    "Authorization: Bearer ${API_TOKEN}",
    "pass" + "word: required",
    "pass" + "word=<your pass" + "word>",
    "set the pass" + "word field to something long",
    "postgres://user:${DB_PASSWORD}@localhost:5432/app",
    "postgres://localhost:5432/app and https://example.com/a/b",
    "the risk-assessment-framework-documentation-for-the-quarterly-review",
    "task-" + "1234567890123456789012345",
    `commit ${sha}`,
    "550e8400-e29b-41d4-a716-446655440000",
    "see [[Some Very Long Note Name With Many Words Inside It And More]]",
    "src/commands/very/deep/path/to/some/module/that/keeps/going/on/forever.ts",
    "AKIA is the prefix of AWS access key ids",
    "tokens starting with the GitHub prefix are checked",
    "VeryLongCamelCaseIdentifierNameWithoutAnyDigitsAtAllInIt",
    "sk-learn is a library",
    "xoxb tokens belong to Slack bots",
    "eyJ is how base64 JSON starts",
  ];
}
