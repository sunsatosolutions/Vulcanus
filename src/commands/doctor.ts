import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "../ui.js";
import { expandHome } from "../util/paths.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { wireHubs } from "../generate/wire.js";
import { buildPlan } from "../manifest/derive.js";
import { repairLifecycle, runDoctor, type DoctorReport } from "../doctor/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { noVaultProblem, reportProblem } from "../errors.js";
import { checkInstructions } from "../instructions/check.js";
import { SOURCE_FILE } from "../instructions/targets.js";

const SYMBOL: Record<string, string> = { error: "✖", warning: "▲", info: "·" };

export function reportDoctor(report: DoctorReport): void {
  const grouped = new Map<string, typeof report.findings>();
  for (const finding of report.findings) {
    const bucket = grouped.get(finding.code) ?? [];
    bucket.push(finding);
    grouped.set(finding.code, bucket);
  }

  for (const [code, findings] of grouped) {
    const lines = findings.map(
      (finding) =>
        `${SYMBOL[finding.level] ?? "·"} ${
          finding.line !== undefined
            ? `${finding.file}:${finding.line} `
            : finding.file
              ? `${finding.file}: `
              : ""
        }${finding.message}${finding.fingerprint ? ` ${finding.fingerprint}` : ""}`,
    );
    p.log.message(`${code}\n${lines.join("\n")}`);
  }
}

export interface DoctorOptions {
  cwd?: string;
  repair?: boolean;
  json?: boolean;
  /** Code repository CODE-DRIFT compares against, instead of each project's `root`. */
  code?: string;
}

async function instructionsOnly(root: string, json?: boolean): Promise<number> {
  const findings = await checkInstructions(root);
  const errors = findings.filter((finding) => finding.level === "error").length;
  const report: DoctorReport = {
    ok: errors === 0,
    filesChecked: 0,
    linksChecked: 0,
    findings,
    counts: { error: errors, warning: findings.length - errors, info: 0 },
    lifecycle: { live: 0, superseded: 0, expired: 0 },
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }
  p.intro("doctor — instruction files (no vulcanus.json)");
  if (findings.length > 0) reportDoctor(report);
  p.outro(
    `${report.ok ? "PASS" : "FAIL"} — instruction files · ${errors} errors · ${findings.length - errors} warnings`,
  );
  return report.ok ? 0 : 1;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);

  if (!vaultRoot) {
    // A repository with an AGENTS.md but no manifest still gets its bridge files checked.
    if (!options.repair && existsSync(resolve(start, SOURCE_FILE))) {
      return instructionsOnly(resolve(start), options.json);
    }
    return reportProblem(noVaultProblem(start, "vulcanus doctor"));
  }

  const manifest = await readManifest(vaultRoot);

  if (options.repair) {
    const { files } = generateFiles(manifest);
    const results = await writeFiles(vaultRoot, files, { repair: true });
    const touched = results
      .filter((entry) => entry.action !== "skipped" && entry.action !== "unchanged")
      .map((entry) => entry.path);

    // Hubs are the operator's to write, so a hub missing a link is repaired by
    // inserting the link, never by regenerating the note around it.
    touched.push(...(await wireHubs(vaultRoot, buildPlan(manifest))));

    // A supersession stated on one side is completed on the other; nothing a
    // human still has to decide (expiry, stale capsule links) is touched.
    touched.push(...(await repairLifecycle(vaultRoot, manifest)));

    if (!options.json) {
      p.log.info(
        touched.length
          ? `Repaired ${touched.length} file(s): ${touched.join(", ")}`
          : "Nothing to repair.",
      );
    }
  }

  const report = await runDoctor(vaultRoot, manifest, {
    codeDir: options.code ? resolve(start, expandHome(options.code)) : undefined,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  p.intro(`doctor — ${manifest.vault.name}`);
  if (report.findings.length > 0) reportDoctor(report);

  const summary = [
    `${report.filesChecked} notes`,
    `${report.linksChecked} links`,
    `${report.counts.error} errors`,
    `${report.counts.warning} warnings`,
  ].join(" · ");

  if (report.ok) {
    p.outro(`PASS — ${summary}`);
  } else {
    p.outro(`FAIL — ${summary}`);
  }

  return report.ok ? 0 : 1;
}
