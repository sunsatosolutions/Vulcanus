import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { planHandoff, runHandoff } from "../ai/handoff.js";
import { messages, type Locale } from "../i18n.js";
import {
  ADAPTERS,
  adapterFor,
  analyzeConversations,
  detectSources,
  type ImportSourceId,
  type ProjectCandidate,
} from "../importers/index.js";
import { generateFiles, writeFiles } from "../generate/index.js";
import { runDoctor } from "../doctor/index.js";
import { writeManifest } from "../manifest/io.js";
import {
  DEFAULT_STRUCTURE,
  MANIFEST_VERSION,
  type ImportRecord,
  type NamingStyle,
  type VaultManifest,
  type VaultProfile,
} from "../manifest/schema.js";
import {
  askConfirm,
  askMultiselect,
  askSelect,
  askText,
  setPromptLocale,
  splitList,
} from "../prompts.js";
import { safeFileName, slugify } from "../util/text.js";
import { CLI_VERSION } from "../version.js";
import { askDetailMode, collectProjectDetails, type DetailMode } from "./add.js";
import { reportDoctor } from "./doctor.js";

const run = promisify(execFile);

function defaultLocale(): Locale {
  const env = `${process.env.LC_ALL ?? ""}${process.env.LANG ?? ""}`.toLowerCase();
  return env.startsWith("tr") || env.includes("tr_") ? "tr" : "en";
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
}

async function isEmptyDir(path: string): Promise<boolean> {
  if (!existsSync(path)) return true;
  const entries = await readdir(path);
  return entries.filter((entry) => entry !== ".git" && entry !== ".DS_Store").length === 0;
}

interface ImportOutcome {
  candidates: ProjectCandidate[];
  record: ImportRecord | null;
}

async function runImport(locale: Locale): Promise<ImportOutcome> {
  const t = messages(locale);

  const spinner = p.spinner();
  spinner.start(t.detecting);
  const detected = await detectSources();
  spinner.stop(detected.length ? t.detected(detected.length) : t.noSourcesFound);

  const choice = await askSelect({
    message: t.importQuestion,
    options: [
      ...detected.map((source) => ({
        value: `${source.source}::${source.path}`,
        label: adapterFor(source.source)?.label ?? source.source,
        hint: `${source.path} — ${source.detail}`,
      })),
      { value: "custom", label: t.importCustom, hint: t.importCustomHint },
      { value: "none", label: t.importNone, hint: t.importNoneHint },
    ],
  });

  if (choice === "none") return { candidates: [], record: null };

  let sourceId: ImportSourceId;
  let path: string;

  if (choice === "custom") {
    path = resolve(
      expandHome((await askText({ message: t.importPathQuestion, required: true })).trim()),
    );
    sourceId = await askSelect<ImportSourceId>({
      message: t.importSourceQuestion,
      options: ADAPTERS.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    });
  } else {
    const [id, ...rest] = choice.split("::");
    sourceId = id as ImportSourceId;
    path = rest.join("::");
  }

  const adapter = adapterFor(sourceId);
  if (!adapter) return { candidates: [], record: null };

  const reading = p.spinner();
  reading.start(t.reading);
  try {
    const analysis = await analyzeConversations(() => adapter.load(path));
    reading.stop(t.readDone(analysis.conversations, analysis.candidates.length));
    if (analysis.conversations === 0) return { candidates: [], record: null };

    return {
      candidates: analysis.candidates,
      record: {
        source: adapter.label,
        date: new Date().toISOString().slice(0, 10),
        conversations: analysis.conversations,
        candidatesAccepted: 0,
        note: "Raw conversations were read locally and never copied into the vault.",
      },
    };
  } catch (error) {
    reading.stop(t.readFailed((error as Error).message));
    return { candidates: [], record: null };
  }
}

export interface InitOptions {
  target?: string;
  locale?: Locale;
  yes?: boolean;
  /** `true` picks the AI path, a string also names the CLI to hand over to. */
  ai?: string | boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<number> {
  let locale = options.locale ?? defaultLocale();
  setPromptLocale(locale);
  let t = messages(locale);

  p.intro(`${t.introTitle} v${CLI_VERSION} — ${t.introBody}`);

  if (!options.locale) {
    locale = await askSelect<Locale>({
      message: t.localeQuestion,
      options: [
        { value: "tr", label: t.localeTr },
        { value: "en", label: t.localeEn },
      ],
      initialValue: locale,
    });
    setPromptLocale(locale);
    t = messages(locale);
  }

  // --- Step 1: import an existing AI history -------------------------------
  p.log.info(t.importHint);
  const imported = await runImport(locale);

  let selectedNames: string[] = [];
  if (imported.candidates.length > 0) {
    const shortlist = imported.candidates.slice(0, 25);
    selectedNames = await askMultiselect({
      message: `${t.candidatesTitle} — ${t.candidatesHint}`,
      options: shortlist.map((candidate) => ({
        value: candidate.name,
        label: t.candidateLabel(
          candidate.name,
          candidate.evidence.conversations,
          candidate.confidence,
        ),
        hint: candidate.evidence.sampleTitles[0]?.slice(0, 60),
      })),
      // Only names the source itself grouped conversations under are safe to
      // pre-check. Title-frequency alone is a proposal, not a decision.
      initialValues: shortlist
        .filter((candidate) => candidate.evidence.explicitGroup)
        .map((candidate) => candidate.name),
    });
  }

  // One editable line instead of a fixed ticked list: imported names arrive with
  // whatever casing the source used ("acme", "sitetools"), and this is the
  // only chance to fix them before they become folder and note names.
  const joined = selectedNames.join(", ");
  const finalList = await askText({
    message: selectedNames.length > 0 ? t.projectListQuestion : t.manualProjectsQuestion,
    placeholder: selectedNames.length > 0 ? t.projectListHint : t.manualProjectsHint,
    ...(joined ? { defaultValue: joined, initialValue: joined } : {}),
  });

  const projectNames = [...new Set(splitList(finalList))];
  if (projectNames.length === 0) p.log.warn(t.noProjects);

  // --- Step 2: vault identity ---------------------------------------------
  p.log.step(t.vaultSection);

  const vaultName = (
    await askText({
      message: t.vaultNameQuestion,
      placeholder: t.vaultNameHint,
      required: true,
    })
  ).trim();

  const fullName = (await askText({ message: t.vaultFullNameQuestion })).trim();
  const tagline = (await askText({ message: t.vaultTaglineQuestion })).trim();

  const naming = await askSelect<NamingStyle>({
    message: t.namingQuestion,
    options: [
      { value: "branded", label: t.namingBranded(vaultName) },
      { value: "generic", label: t.namingGeneric },
    ],
    initialValue: "branded",
  });

  const profile = await askSelect<VaultProfile>({
    message: t.profileQuestion,
    options: [
      { value: "core", label: t.profileCore, hint: t.profileCoreHint },
      { value: "full", label: t.profileFull, hint: t.profileFullHint },
    ],
    initialValue: "core",
  });

  // --- Step 3: operator ----------------------------------------------------
  p.log.step(t.adminSection);

  const adminName = (await askText({ message: t.adminNameQuestion, required: true })).trim();
  const adminRole = (
    await askText({ message: t.adminRoleQuestion, placeholder: t.adminRoleHint })
  ).trim();
  const adminAliases = splitList(
    await askText({ message: t.adminAliasesQuestion, placeholder: t.adminAliasesHint }),
  );

  // --- Step 4: project details --------------------------------------------
  const requested: DetailMode =
    projectNames.length === 0 ? "skip" : options.ai ? "ai" : await askDetailMode(locale);

  // The handoff is planned now but runs after the vault exists, because the AI
  // is given the real note paths. No AI CLI means the questions get asked here.
  const handoff =
    requested === "ai"
      ? await planHandoff(
          projectNames,
          locale,
          typeof options.ai === "string" ? options.ai : undefined,
        )
      : null;
  const mode: DetailMode = requested === "ai" && !handoff ? "manual" : requested;

  const { projects, groups } = await collectProjectDetails(
    projectNames,
    { projects: [], groups: [] },
    locale,
    mode,
  );

  // --- Step 5: destination -------------------------------------------------
  // Default to the vault's own name so Obsidian shows the vault under that name.
  const defaultTarget = options.target ?? `./${safeFileName(vaultName) || "vault"}`;
  const targetInput = await askText({
    message: t.targetQuestion,
    placeholder: t.targetHint,
    defaultValue: defaultTarget,
    initialValue: defaultTarget,
  });
  const vaultRoot = resolve(process.cwd(), expandHome(targetInput.trim() || defaultTarget));

  if (!(await isEmptyDir(vaultRoot))) p.log.warn(t.overwriteWarning(vaultRoot));

  const wantsGit = await askConfirm({ message: t.gitQuestion, initialValue: true });

  // --- Step 6: generate ----------------------------------------------------
  const manifest: VaultManifest = {
    manifestVersion: MANIFEST_VERSION,
    generator: { name: "vulcanus", version: CLI_VERSION },
    vault: {
      name: vaultName,
      ...(fullName ? { fullName } : {}),
      ...(tagline ? { tagline } : {}),
      language: locale,
      naming,
      profile,
    },
    admin: {
      name: adminName,
      ...(adminRole ? { role: adminRole } : {}),
      aliases: adminAliases,
      language: locale,
      workingStyle: [],
      technical: [],
      boundaries: [],
    },
    structure: {
      ...DEFAULT_STRUCTURE,
      stateDir: `.${slugify(vaultName) || "vault"}`,
    },
    groups,
    projects,
    imports: imported.record
      ? [{ ...imported.record, candidatesAccepted: selectedNames.length }]
      : [],
  };

  const { files } = generateFiles(manifest);

  const proceed =
    options.yes ||
    (await askConfirm({ message: t.confirmQuestion(files.length, vaultRoot), initialValue: true }));
  if (!proceed) {
    p.cancel(t.cancelled);
    return 130;
  }

  const generating = p.spinner();
  generating.start(t.generating);
  await mkdir(vaultRoot, { recursive: true });
  await writeManifest(vaultRoot, manifest);
  const results = await writeFiles(vaultRoot, files);
  generating.stop(`${results.filter((entry) => entry.action === "created").length} files created`);

  if (wantsGit && !existsSync(resolve(vaultRoot, ".git"))) {
    try {
      await run("git", ["init", "--quiet"], { cwd: vaultRoot });
    } catch (error) {
      p.log.warn(`git init failed: ${(error as Error).message}`);
    }
  }

  // --- Step 7: validate ----------------------------------------------------
  const validating = p.spinner();
  validating.start(t.validating);
  const report = await runDoctor(vaultRoot, manifest);
  validating.stop(
    report.ok
      ? t.doctorPassed(report.filesChecked, report.linksChecked)
      : t.doctorFailed(report.counts.error),
  );

  if (!report.ok) reportDoctor(report);

  // --- Step 8: hand the notes to a local AI --------------------------------
  const afterAi = handoff ? await runHandoff(vaultRoot, manifest, handoff, locale) : null;

  p.note(t.nextSteps(vaultRoot), t.summaryTitle);
  p.outro(`${vaultName} → ${vaultRoot}`);

  return (afterAi ?? report).ok ? 0 : 1;
}
