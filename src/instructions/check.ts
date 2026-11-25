import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DoctorFinding } from "../doctor/index.js";
import { SOURCE_FILE, TARGETS, readMarker, renderTarget } from "./targets.js";

/** Doctor codes this module owns; `status` counts them as instruction drift. */
export const INSTRUCTION_CODES = ["INSTRUCTION-SOURCE", "INSTRUCTION-STALE"] as const;

/**
 * Checks the bridge files that carry a Vulcanus marker. A file without one is
 * the operator's and is none of doctor's business; a missing bridge file is
 * not drift either, `bridge` shows it.
 */
export async function checkInstructions(root: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const sourcePath = resolve(root, SOURCE_FILE);
  const source = existsSync(sourcePath) ? await readFile(sourcePath, "utf8") : null;

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
