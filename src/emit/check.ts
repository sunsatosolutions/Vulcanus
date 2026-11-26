import type { DoctorFinding } from "../doctor/index.js";
import type { VaultManifest } from "../manifest/schema.js";
import { buildPlan } from "../manifest/derive.js";
import { hasEmitMarker } from "./block.js";
import { planProject, staleReason } from "./plan.js";

/**
 * Doctor findings for the agent files `emit` writes: a block that fell behind the notes,
 * a file that went missing, damaged markers. A repository `emit` never touched is left
 * alone (one info line), so a project that does not use `emit` is not nagged.
 */
export async function checkEmit(
  vaultRoot: string,
  manifest: VaultManifest,
  notes: ReadonlyMap<string, string>,
  on: string,
): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  for (const plan of buildPlan(manifest).allProjects) {
    if (typeof plan.project.root !== "string" || plan.project.visibility === "private") continue;
    const job = await planProject(plan, {
      vaultRoot,
      manifest,
      notes,
      cwd: vaultRoot,
      on,
      includePrivate: false,
    });
    if (!("files" in job)) continue;
    const behind = job.files.filter((file) => file.state !== "unchanged");
    if (behind.length === 0) continue;
    const emitted = job.files.some(hasEmitMarker);
    const name = plan.project.name;
    if (!emitted) {
      findings.push({
        level: "info",
        code: "EMIT-MISSING",
        message: `${name}: agent files hold no vulcanus block yet; \`vulcanus emit ${plan.project.id} --dry-run\` shows what would be written`,
      });
      continue;
    }
    for (const file of behind) {
      findings.push({
        level: "warning",
        code: "EMIT-STALE",
        message: `${name}: ${file.path} is ${staleReason(file)}; run \`vulcanus emit ${plan.project.id}\``,
        file: file.path,
      });
    }
  }
  return findings;
}
