import { isAllowed, readAllow, type AllowList } from "./allow.js";
import { maskSecrets, scanText, type SecretFinding } from "./detector.js";

/** A vault write refused because it would add a secret. Names kinds and lines, never values. */
export class SecretWriteError extends Error {
  constructor(file: string, findings: SecretFinding[]) {
    const what = findings.map((entry) => `${entry.kind} (line ${entry.line})`).join(", ");
    super(
      `Refused: ${file} would gain a value matching a known secret pattern: ${what}. Nothing was written. Remove the value; if it is not a secret, add a reasoned entry to .vulcanus-allow.`,
    );
    this.name = "SecretWriteError";
  }
}

/**
 * Throw when `after` holds a secret that `before` did not. A secret already in
 * the file does not block an unrelated edit; `.vulcanus-allow` is honoured.
 */
export async function assertNoNewSecrets(
  vaultRoot: string,
  file: string,
  before: string,
  after: string,
): Promise<void> {
  const allow = await readAllow(vaultRoot);
  const known = new Map<string, number>();
  for (const entry of scanText(before, file)) {
    known.set(entry.fingerprint, (known.get(entry.fingerprint) ?? 0) + 1);
  }
  const added = scanText(after, file).filter((entry) => {
    const left = known.get(entry.fingerprint) ?? 0;
    if (left > 0) {
      known.set(entry.fingerprint, left - 1);
      return false;
    }
    return !isAllowed(allow, entry);
  });
  if (added.length) throw new SecretWriteError(file, added);
}

/** `text` with the secrets in it masked, minus what `.vulcanus-allow` spares. */
export function screenText(allow: AllowList | null, text: string, file: string) {
  return maskSecrets(text, file, {}, (finding) => isAllowed(allow, finding));
}
