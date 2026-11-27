import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SecretFinding } from "./detector.js";

export const ALLOW_FILE = ".vulcanus-allow";

export interface AllowList {
  /** `file:line:kind` entries. */
  locations: Set<string>;
  /** 12-hex fingerprints. */
  fingerprints: Set<string>;
  /** Lines that could not be used, with why. Never echoes the line's text. */
  errors: { line: number; message: string }[];
}

const FINGERPRINT = /^[0-9a-f]{12}$/;
const LOCATION = /^(.+):(\d+):([a-z0-9-]+)$/;

export function locationKey(finding: Pick<SecretFinding, "file" | "line" | "kind">): string {
  return `${finding.file}:${finding.line}:${finding.kind}`;
}

/**
 * Parse `.vulcanus-allow`: one finding per line, `file:line:kind # reason` or
 * `<fingerprint> # reason`. A reason is required; `#` at line start is a comment.
 */
export function parseAllow(text: string): AllowList {
  const list: AllowList = { locations: new Set(), fingerprints: new Set(), errors: [] };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const split = /^(\S.*?)\s+#\s*(.*)$/.exec(trimmed);
    if (!split) {
      list.errors.push({ line, message: "entry has no reason; add `# why this is not a secret`" });
      return;
    }
    const [, target, reason] = split;
    if (!reason.trim()) {
      list.errors.push({ line, message: "reason is empty; say why this is not a secret" });
      return;
    }
    if (FINGERPRINT.test(target)) {
      list.fingerprints.add(target);
    } else if (LOCATION.test(target)) {
      list.locations.add(target.replace(/\\/g, "/"));
    } else {
      list.errors.push({
        line,
        message: "entry is neither `file:line:kind` nor a 12-hex fingerprint",
      });
    }
  });
  return list;
}

export async function readAllow(vaultRoot: string): Promise<AllowList | null> {
  const path = resolve(vaultRoot, ALLOW_FILE);
  if (!existsSync(path)) return null;
  return parseAllow(await readFile(path, "utf8"));
}

export function isAllowed(list: AllowList | null, finding: SecretFinding): boolean {
  if (!list) return false;
  return list.locations.has(locationKey(finding)) || list.fingerprints.has(finding.fingerprint);
}
