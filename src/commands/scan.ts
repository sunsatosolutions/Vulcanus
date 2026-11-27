import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadVaultNotes } from "../doctor/index.js";
import { EXIT, noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { askConfirm } from "../prompts.js";
import { ALLOW_FILE, isAllowed, readAllow, type AllowList } from "../secrets/allow.js";
import { maskSecrets, scanText, type SecretFinding } from "../secrets/detector.js";
import * as p from "../ui.js";

export { ALLOW_FILE };

export interface ScanOptions {
  cwd?: string;
  fix?: boolean;
  /** `<file>:<line>`: allow every finding on that line; needs `reason`. */
  allow?: string;
  /** Why the allowed finding is not a secret; written next to the entry. */
  reason?: string;
  /** Whether a person can answer a prompt; defaults to the terminal's state. */
  interactive?: boolean;
}

async function scanVault(vaultRoot: string): Promise<{
  findings: SecretFinding[];
  texts: Map<string, string>;
  allowList: AllowList | null;
}> {
  const manifest = await readManifest(vaultRoot);
  const notes = await loadVaultNotes(vaultRoot, manifest);
  const allowList = await readAllow(vaultRoot);
  const findings: SecretFinding[] = [];
  for (const file of notes.files) {
    for (const hit of scanText(notes.contents.get(file) ?? "", file)) {
      if (!isAllowed(allowList, hit)) findings.push(hit);
    }
  }
  return { findings, texts: notes.contents, allowList };
}

function report(findings: SecretFinding[]): void {
  if (findings.length) {
    process.stdout.write(
      findings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.fingerprint}\n`).join(""),
    );
  }
}

async function allow(
  vaultRoot: string,
  target: string,
  reason: string | undefined,
  findings: SecretFinding[],
): Promise<number> {
  const at = target.lastIndexOf(":");
  const file = target.slice(0, at);
  const line = Number(target.slice(at + 1));
  const hits = findings.filter((f) => f.file === file && f.line === line);
  if (at < 1 || hits.length === 0) {
    return reportProblem({
      what: `No finding at ${target}.`,
      why: "Only a line that scan reports can be allowed.",
      fix: "vulcanus scan   # lists file:line; pass one of them as --allow <file:line>",
    });
  }
  const why = reason?.replace(/\s+/g, " ").trim();
  if (!why) {
    return reportProblem({
      what: "--allow needs a reason.",
      why: "An entry without a reason is an error in .vulcanus-allow.",
      fix: `vulcanus scan --allow ${target} --reason "why this is not a secret"`,
    });
  }
  const path = resolve(vaultRoot, ALLOW_FILE);
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  const add = hits.map((f) => `${f.fingerprint} # ${why} (${f.kind})\n`).join("");
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, current + sep + add);
  p.log.success(`Allowed ${hits.length} finding(s) in ${ALLOW_FILE}.`);
  return EXIT.ok;
}

async function fix(
  vaultRoot: string,
  findings: SecretFinding[],
  texts: Map<string, string>,
  allowList: AllowList | null,
  interactive: boolean,
): Promise<number> {
  if (findings.length === 0) return EXIT.ok;
  const edits = new Map<string, string>();
  for (const file of new Set(findings.map((f) => f.file))) {
    const masked = maskSecrets(texts.get(file) ?? "", file, {}, (f) => isAllowed(allowList, f));
    process.stdout.write(`${file}\n`);
    for (const line of masked.text.split(/\r?\n/)) {
      if (line.includes("[REDACTED:")) process.stdout.write(`  -> ${line}\n`);
    }
    edits.set(file, masked.text);
  }
  if (!interactive) {
    return reportProblem(
      {
        what: "scan --fix needs a terminal to approve the change. Nothing was written.",
        why: "Nothing is rewritten without a yes.",
        fix: "run vulcanus scan --fix in a terminal",
      },
      EXIT.failed,
    );
  }
  if (!(await askConfirm({ message: "Apply these changes?", initialValue: false }))) {
    p.outro("Nothing was written.");
    return EXIT.cancelled;
  }
  for (const file of edits.keys()) {
    const now = await readFile(resolve(vaultRoot, file), "utf8").catch(() => null);
    if (now !== texts.get(file)) {
      return reportProblem(
        {
          what: `${file} changed while waiting for approval. Nothing was written.`,
          why: "Writing now would overwrite the newer content.",
          fix: "run vulcanus scan --fix again",
        },
        EXIT.failed,
      );
    }
  }
  for (const [file, text] of edits) await writeFile(resolve(vaultRoot, file), text);
  p.outro(`Redacted ${findings.length} finding(s) in ${edits.size} file(s).`);
  return EXIT.ok;
}

export async function scanCommand(options: ScanOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);
  if (!vaultRoot) return reportProblem(noVaultProblem(start, "vulcanus scan"));
  if (options.fix && options.allow) {
    return reportProblem({
      what: "--fix and --allow cannot be used together.",
      fix: "Run them one at a time.",
    });
  }

  const { findings, texts, allowList } = await scanVault(vaultRoot);
  if (options.allow) return allow(vaultRoot, options.allow, options.reason, findings);

  if (options.fix) {
    const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    return fix(vaultRoot, findings, texts, allowList, interactive);
  }

  report(findings);
  if (findings.length > 0) return EXIT.failed;
  p.log.success("No secrets matched a known pattern.");
  return EXIT.ok;
}
