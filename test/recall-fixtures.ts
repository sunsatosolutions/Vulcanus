/**
 * Recall fixtures for Blackbar: fake secrets in the shapes people paste into notes.
 * The repository is public, so no value sits whole in a file: prefixes and bodies
 * are joined while the tests run. Nothing here is a real credential.
 */

export interface RecallFixture {
  id: string;
  family: string;
  /** The line as it would sit in a note. */
  line: string;
  /** The secret inside the line; masking must remove it. */
  value: string;
}

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const B64URL = `${ALNUM}-_`;

/** Deterministic pseudo-random text; a fixed seed keeps failures reproducible. */
function body(length: number, seed: number, alphabet = ALNUM): string {
  let state = seed * 2654435761 + 12345;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor(state / 65536) % alphabet.length];
  }
  return out;
}

const b64url = (text: string) => Buffer.from(text).toString("base64url");

export function recallFixtures(): RecallFixture[] {
  const out: RecallFixture[] = [];
  const add = (family: string, value: string, template: string) =>
    out.push({
      id: `${family}-${out.filter((f) => f.family === family).length + 1}`,
      family,
      value,
      line: template.replace("$V", () => value),
    });

  // sk- keys
  for (const [i, t] of [
    "OpenAI key: $V",
    "OPENAI_API_KEY=$V",
    "curl -u $V https://x.test",
  ].entries())
    add("sk", ["s", "k-", body(44, 1 + i)].join(""), t);
  add("sk", `sk-${"ant"}-api03-${body(60, 5, B64URL)}`, "anthropic: $V");
  add("sk", `sk-${"pro"}j-${body(48, 6, B64URL)}`, "export KEY=$V # old");

  // GitHub tokens
  for (const [i, p] of ["gh" + "p_", "gh" + "o_", "gh" + "s_", "gh" + "u_"].entries())
    add("github", p + body(36, 10 + i), "token: $V");
  add("github", ["github", "_pat_", body(22, 15), "_", body(40, 16)].join(""), "$V");
  add("github", "gh" + "p_" + body(40, 17), "git clone https://$V@host.test/r.git");

  // AWS access keys
  for (const [i, p] of ["AK" + "IA", "AS" + "IA", "AK" + "IA"].entries())
    add("aws", p + body(16, 20 + i, UPPER), "aws_access_key_id = $V");

  // Slack
  add("slack", ["xo", "xb-", body(12, 30, "0123456789"), "-", body(24, 31)].join(""), "SLACK=$V");
  add("slack", ["xo", "xp-", body(12, 32, "0123456789"), "-", body(24, 33)].join(""), "$V");
  add("slack", ["xo", "xa-2-", body(12, 34, "0123456789"), "-", body(20, 35)].join(""), "t: $V");

  // JWT
  for (let i = 0; i < 3; i++) {
    const jwt = [
      b64url(`{"alg":"HS256","typ":"JWT","n":${i}}`),
      b64url(`{"sub":"user-${i}","name":"Fixture","iat":1700000${i}00}`),
      body(43, 40 + i, B64URL),
    ].join(".");
    add("jwt", jwt, ["session_token = $V", "jwt: $V", "cookie sid=$V; path=/"][i]);
  }

  // Authorization: Bearer
  for (const [i, t] of [
    "Authorization: Bearer $V",
    "curl -H 'Authorization: Bearer $V' https://x.test",
    'headers = {"Authorization": "Bearer $V"}',
  ].entries())
    add("bearer", body(40, 50 + i, B64URL), t);

  // password= : quoted, unquoted, escaped
  add("password-unquoted", body(14, 60) + "7!", "password=$V");
  add("password-unquoted", body(12, 61) + "#9", "DB_PASSWORD=$V");
  add("password-quoted", body(16, 62) + "!4", 'password = "$V"');
  add("password-quoted", body(16, 63) + "@8", "passwd: '$V'");
  add("password-escaped", `${body(8, 64)}\\"${body(6, 65)}9`, 'password="$V"');
  add("password-escaped", `${body(8, 66)}\\'${body(6, 67)}3`, "password='$V'");
  add("password-escaped", `${body(7, 68)}\\\\${body(7, 69)}5`, 'secret_password = "$V"');

  // Password inside a connection string
  for (const [i, t] of [
    "postgres://app:$V@db.test:5432/app",
    "mongodb+srv://root:$V@cluster.test/db",
    "DATABASE_URL=mysql://u:$V@10.0.0.5/x",
  ].entries())
    add("conn-string", body(14, 70 + i) + "9", t);

  // High-entropy strings next to a keyword
  for (const [i, t] of [
    "api_key: $V",
    "client_secret = $V",
    "access_token=$V",
    "private_key: $V",
  ].entries())
    add("entropy", body(32, 80 + i), t);

  return out;
}
