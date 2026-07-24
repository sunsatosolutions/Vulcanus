import * as p from "@clack/prompts";
import { generateFiles, writeFiles } from "../generate/index.js";
import { runDoctor, type DoctorReport } from "../doctor/index.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";

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
    process.stderr.write(
      `No vulcanus.json found in ${start} or any parent directory.\nRun \`vulcanus init\` to create a vault.\n`,
    );
    return 2;
  }

  const manifest = await readManifest(vaultRoot);

  if (options.repair) {
    const { files } = generateFiles(manifest);
    const results = await writeFiles(vaultRoot, files, { repair: true });
    const touched = results.filter(
      (entry) => entry.action !== "skipped" && entry.action !== "unchanged",
    );
    if (!options.json) {
      p.log.info(
        touched.length
          ? `Repaired ${touched.length} generated file(s): ${touched.map((entry) => entry.path).join(", ")}`
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
