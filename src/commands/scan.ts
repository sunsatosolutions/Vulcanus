import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadVaultNotes } from "../doctor/index.js";
import { EXIT, noVaultProblem, reportProblem } from "../errors.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { askConfirm } from "../prompts.js";
import { detectLine, type SecretMatch } from "../secrets/detect.js";
import * as p from "../ui.js";

export const ALLOW_FILE = ".vulcanus-allow";

export interface ScanOptions {
  cwd?: string;
  fix?: boolean;
  /** `<file>:<line>`: allow every finding on that line. */
  allow?: string;
  /** Whether a person can answer a prompt; defaults to the terminal's state. */
  interactive?: boolean;
}

export interface ScanFinding extends SecretMatch {
  file: string;
  /** 1-based. */
  line: number;
}

/** Hashes in `.vulcanus-allow`; one `sha256:<hex> [note]` per line, `#` starts a comment. */
async function readAllow(vaultRoot: string): Promise<Set<string>> {
  const path = resolve(vaultRoot, ALLOW_FILE);
  if (!existsSync(path)) return new Set();
  const hashes = new Set<string>();
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const match = /^sha256:([0-9a-f]{64})(?:\s|$)/.exec(line.trim());
    if (match) hashes.add(match[1]);
  }
  return hashes;
}

/** Lines keep their own terminator, so a patch never changes line endings. */
const splitLines = (text: string): string[] => text.split(/(?<=\n)/);
const bare = (line: string): string => line.replace(/\r?\n$/, "");

function redact(line: string, findings: SecretMatch[]): string {
  let out = bare(line);
  for (const f of [...findings].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, f.start)}[REDACTED:${f.type}]${out.slice(f.end)}`;
  }
  return out + line.slice(bare(line).length);
}

async function scanVault(vaultRoot: string): Promise<{
  findings: ScanFinding[];
  texts: Map<string, string>;
}> {
  const manifest = await readManifest(vaultRoot);
  const notes = await loadVaultNotes(vaultRoot, manifest);
  const allowed = await readAllow(vaultRoot);
  const findings: ScanFinding[] = [];
  for (const file of notes.files) {
    splitLines(notes.contents.get(file) ?? "").forEach((raw, index) => {
      for (const match of detectLine(bare(raw))) {
        if (!allowed.has(match.hash)) findings.push({ ...match, file, line: index + 1 });
      }
    });
  }
  return { findings, texts: notes.contents };
}

function report(findings: ScanFinding[]): void {
  const out = (level: ScanFinding["level"]) =>
    findings.filter((f) => f.level === level).map((f) => `${f.file}:${f.line} ${f.type}\n`);
  const errors = out("error");
  const warnings = out("warning");
  if (errors.length) process.stdout.write(errors.join(""));
  if (warnings.length) process.stdout.write(`warnings:\n${warnings.join("")}`);
}

async function allow(vaultRoot: string, target: string, findings: ScanFinding[]): Promise<number> {
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
  const path = resolve(vaultRoot, ALLOW_FILE);
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  const add = hits.map((f) => `sha256:${f.hash} ${f.type}\n`).join("");
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, current + sep + add);
  p.log.success(`Allowed ${hits.length} finding(s) in ${ALLOW_FILE}.`);
  return EXIT.ok;
}

async function fix(
  vaultRoot: string,
  findings: ScanFinding[],
  texts: Map<string, string>,
  interactive: boolean,
): Promise<number> {
  if (findings.length === 0) return EXIT.ok;
  const patches = new Map<string, Map<number, ScanFinding[]>>();
  for (const f of findings) {
    const lines = patches.get(f.file) ?? new Map<number, ScanFinding[]>();
    lines.set(f.line, [...(lines.get(f.line) ?? []), f]);
    patches.set(f.file, lines);
  }
  const edits = new Map<string, string>();
  for (const [file, lines] of patches) {
    const parts = splitLines(texts.get(file) ?? "");
    process.stdout.write(`${file}\n`);
    for (const [number, hits] of lines) {
      const next = redact(parts[number - 1], hits);
      process.stdout.write(`  line ${number}: ${bare(next)}\n`);
      parts[number - 1] = next;
    }
    edits.set(file, parts.join(""));
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

  const { findings, texts } = await scanVault(vaultRoot);
  if (options.allow) return allow(vaultRoot, options.allow, findings);

  if (options.fix) {
    const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    return fix(vaultRoot, findings, texts, interactive);
  }

  report(findings);
  const errors = findings.filter((f) => f.level === "error").length;
  if (errors > 0) return EXIT.failed;
  if (findings.length === 0) p.log.success("No secrets found.");
  return EXIT.ok;
}
