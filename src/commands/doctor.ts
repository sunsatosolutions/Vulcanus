import * as p from "../ui.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { wireHubs } from "../generate/wire.js";
import { buildPlan } from "../manifest/derive.js";
import { runDoctor, type DoctorReport } from "../doctor/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { noVaultProblem, reportProblem } from "../errors.js";

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
        `${SYMBOL[finding.level] ?? "·"} ${finding.file ? `${finding.file}: ` : ""}${finding.message}`,
    );
    p.log.message(`${code}\n${lines.join("\n")}`);
  }
}

export interface DoctorOptions {
  cwd?: string;
  repair?: boolean;
  json?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<number> {
  const start = options.cwd ?? process.cwd();
  const vaultRoot = findVaultRoot(start);

  if (!vaultRoot) {
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

    if (!options.json) {
      p.log.info(
        touched.length
          ? `Repaired ${touched.length} file(s): ${touched.join(", ")}`
          : "Nothing to repair.",
      );
    }
  }

  const report = await runDoctor(vaultRoot, manifest);

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
