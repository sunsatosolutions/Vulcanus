import * as p from "../ui.js";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PERSONAL_SKILL_DIRS, SKILL_DIRS, buildSkills, renderSkill } from "../generate/skills.js";
import { buildPlan } from "../manifest/derive.js";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import { messages, type Locale } from "../i18n.js";
import { noVaultProblem, reportProblem } from "../errors.js";

const TARGETS: Array<{ tool: string; where: string }> = [
  { tool: "Claude Code", where: "~/.claude/skills/" },
  { tool: "Codex", where: "~/.agents/skills/" },
  { tool: "Cursor", where: "~/.agents/skills/" },
  { tool: "Gemini CLI", where: "~/.agents/skills/" },
];

export interface SkillsOptions {
  cwd?: string;
  /** Print the skill files themselves, so they can be inspected or piped. */
  raw?: boolean;
  /** Write into the operator's personal skill directories, outside the vault. */
  install?: boolean;
  /** Replace personal skill files that already exist. */
  force?: boolean;
}

export async function skillsCommand(options: SkillsOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    return reportProblem(noVaultProblem(options.cwd ?? process.cwd(), "vulcanus skills"));
  }

  const manifest = await readManifest(vaultRoot);
  const plan = buildPlan(manifest);
  const locale: Locale = manifest.vault.language === "tr" ? "tr" : "en";
  const t = messages(locale);

  // Personal skills load from anywhere, so they must name the vault's real path.
  const skills = buildSkills(plan, vaultRoot);

  if (options.raw) {
    for (const skill of skills) {
      process.stdout.write(`${renderSkill(skill)}\n`);
    }
    return 0;
  }

  p.intro(`skills — ${manifest.vault.name}`);
  p.log.info(t.skillsExplain);

  if (options.install) {
    const home = homedir();
    let written = 0;
    let kept = 0;

    for (const dir of PERSONAL_SKILL_DIRS) {
      for (const skill of skills) {
        const target = join(home, dir.replace(/^~\//, ""), skill.name, "SKILL.md");
        if (existsSync(target) && !options.force) {
          kept += 1;
          continue;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, renderSkill(skill), "utf8");
        written += 1;
      }
    }

    p.log.success(t.skillsInstalled(written, PERSONAL_SKILL_DIRS.join(" and ")));
    if (kept) p.log.warn(t.skillsKept(kept));
  } else {
    p.log.message(t.skillsForceHint);
  }

  p.note(skills.map((skill) => skill.name).join("\n"), `${skills.length} skills`);
  p.log.message(t.skillsInVault(skills.length));
  p.note(SKILL_DIRS.map((dir) => resolve(vaultRoot, dir)).join("\n"), "In this vault");

  if (!options.install) {
    p.note(
      TARGETS.map((target) => `${target.tool.padEnd(12)} ${target.where}`).join("\n"),
      "Where they go",
    );
    p.log.message(t.skillsInstallHint);
  }

  p.outro(t.skillsOutro);
  return 0;
}
