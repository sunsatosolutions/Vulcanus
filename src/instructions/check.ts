import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DoctorFinding } from "../doctor/index.js";
import {
  CODEX_FILES,
  INSTRUCTION_BUDGET_BYTES,
  SOURCE_FILE,
  TARGETS,
  readMarker,
  renderTarget,
} from "./targets.js";

/** Doctor codes this module owns; `status` counts them as instruction drift. */
export const INSTRUCTION_CODES = [
  "INSTRUCTION-SOURCE",
  "INSTRUCTION-STALE",
  "INSTRUCTION-BUDGET",
  "INSTRUCTION-CONFLICT",
] as const;

const PACKAGE_MANAGER =
  /\b(npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|run|test|build|start|dev|lint|exec)\b/g;
const TEST_RUNNER = /\b(vitest|jest|mocha|pytest)\b/g;
/** A line that says what not to use is not an instruction to use it. */
const NEGATED = /\b(?:not|never|don't|do not|instead of|avoid)\b|yerine|kullanma/i;

interface Seen {
  line: number;
  text: string;
}

/**
 * What a hand-written file says, by kind: the commands it names, first line wins.
 * Fenced code blocks and negated lines are skipped; a command is only compared
 * across files, never inside one.
 */
function commandsIn(text: string): { managers: Map<string, Seen>; runners: Map<string, Seen> } {
  const managers = new Map<string, Seen>();
  const runners = new Map<string, Seen>();
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced || NEGATED.test(line)) return;
    const seen = { line: index + 1, text: line.trim() };
    for (const found of line.matchAll(PACKAGE_MANAGER)) {
      if (!managers.has(found[1])) managers.set(found[1], seen);
    }
    for (const found of line.matchAll(TEST_RUNNER)) {
      if (!runners.has(found[1])) runners.set(found[1], seen);
    }
  });
  return { managers, runners };
}

/** Exactly one name in the file, or null: a file that names two is not taking a side. */
function single(names: Map<string, Seen>): [string, Seen] | null {
  return names.size === 1 ? [...names][0] : null;
}

async function checkBudget(root: string): Promise<DoctorFinding[]> {
  for (const name of CODEX_FILES) {
    const file = resolve(root, name);
    if (!existsSync(file)) continue;
    const bytes = await readFile(file);
    if (bytes.toString("utf8").trim() === "") continue;
    if (bytes.byteLength <= INSTRUCTION_BUDGET_BYTES) return [];
    return [
      {
        level: "warning",
        code: "INSTRUCTION-BUDGET",
        message: `Codex reads only ${name}, ${bytes.byteLength} bytes; its default limit is ${INSTRUCTION_BUDGET_BYTES} and the rest is cut off`,
        file: name,
      },
    ];
  }
  return [];
}

async function checkConflicts(root: string, source: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const mine = commandsIn(source.replace(/\r\n/g, "\n"));
  for (const target of TARGETS) {
    const file = resolve(root, target.path);
    if (!existsSync(file)) continue;
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    if (readMarker(text)) continue;
    const theirs = commandsIn(text);
    for (const [kind, a, b] of [
      ["package manager", single(mine.managers), single(theirs.managers)],
      ["test runner", single(mine.runners), single(theirs.runners)],
    ] as const) {
      if (!a || !b || a[0] === b[0]) continue;
      findings.push({
        level: "warning",
        code: "INSTRUCTION-CONFLICT",
        message: `${kind} ${b[0]} (line ${b[1].line}: "${b[1].text}") conflicts with ${a[0]} in ${SOURCE_FILE} (line ${a[1].line}: "${a[1].text}")`,
        file: target.path,
      });
    }
  }
  return findings;
}

/**
 * Checks the bridge files that carry a Vulcanus marker. A file without one is
 * the operator's and is none of doctor's business; a missing bridge file is
 * not drift either, `bridge` shows it.
 */
export async function checkInstructions(root: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const sourcePath = resolve(root, SOURCE_FILE);
  const source = existsSync(sourcePath) ? await readFile(sourcePath, "utf8") : null;
  findings.push(...(await checkBudget(root)));
  if (source !== null) findings.push(...(await checkConflicts(root, source)));

  for (const target of TARGETS) {
    const file = resolve(root, target.path);
    if (!existsSync(file)) continue;
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    const marker = readMarker(text);
    if (!marker) continue;

    const broken = (message: string) =>
      findings.push({ level: "error", code: "INSTRUCTION-SOURCE", message, file: target.path });

    if (source === null) {
      broken(`${SOURCE_FILE} is missing, so this file points at nothing; restore or remove it`);
    } else if (marker.source !== SOURCE_FILE) {
      broken(
        `names ${marker.source} as its source, not ${SOURCE_FILE}; run \`vulcanus bridge --write\``,
      );
    } else if (target.mode === "import" && !text.split("\n").includes(`@${SOURCE_FILE}`)) {
      broken(`no longer imports ${SOURCE_FILE}; run \`vulcanus bridge --write\``);
    } else if (
      target.mode === "copy" &&
      text !== renderTarget(target, source).replace(/\r\n/g, "\n")
    ) {
      findings.push({
        level: "error",
        code: "INSTRUCTION-STALE",
        message: `copy of ${SOURCE_FILE} is out of date; run \`vulcanus bridge --write\``,
        file: target.path,
      });
    }
  }
  return findings;
}
