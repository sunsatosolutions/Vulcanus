import * as p from "../ui.js";
import { resolve } from "node:path";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import {
  ADAPTERS,
  adapterFor,
  analyzeConversations,
  detectSources,
  type ImportSourceId,
} from "../importers/index.js";
import { readSeen, rememberIds, seenIds, skipSeen, writeSeen } from "../importers/seen.js";
import { messages, type Locale } from "../i18n.js";
import { askMultiselect, askSelect, askText, setPromptLocale } from "../prompts.js";
import { planHandoff, runHandoff } from "../ai/handoff.js";
import { applyProjects, askDetailMode, collectProjectDetails, type DetailMode } from "./add.js";
import { noVaultProblem, reportProblem } from "../errors.js";

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
}

export interface ImportOptions {
  cwd?: string;
  source?: ImportSourceId;
  path?: string;
  /** `true` picks the AI path, a string also names the CLI to hand over to. */
  ai?: string | boolean;
  /**
   * Report what the analysis found and write nothing. Accepting candidates is a
   * judgement call about the operator's own work, so the JSON mode stops short
   * of it rather than inventing projects unattended.
   */
  json?: boolean;
  /**
   * Re-read conversations this vault has already imported. Off by default: the
   * second run on the same export should only surface what is new.
   */
  all?: boolean;
}

export async function importCommand(options: ImportOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    return reportProblem(noVaultProblem(options.cwd ?? process.cwd(), "vulcanus import"));
  }

  const manifest = await readManifest(vaultRoot);
  const locale: Locale = manifest.vault.language === "tr" ? "tr" : "en";
  setPromptLocale(locale);
  const t = messages(locale);

  if (!options.json) {
    p.intro(`import — ${manifest.vault.name}`);
    p.log.info(t.importHint);
  }

  let sourceId = options.source;
  let path = options.path ? resolve(options.path) : undefined;

  if (options.json && (!sourceId || !path)) {
    const detected = await detectSources();
    process.stdout.write(
      `${JSON.stringify({ vault: manifest.vault.name, detected, candidates: [] }, null, 2)}\n`,
    );
    return detected.length ? 0 : 2;
  }

  if (!sourceId || !path) {
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
      ],
    });

    if (choice === "custom") {
      const answered = await askText({ message: t.importPathQuestion, required: true });
      path = resolve(expandHome(answered.trim()));
      sourceId = await askSelect<ImportSourceId>({
        message: t.importSourceQuestion,
        options: ADAPTERS.map((adapter) => ({ value: adapter.id, label: adapter.label })),
      });
    } else {
      const [id, ...rest] = choice.split("::");
      sourceId = id as ImportSourceId;
      path = rest.join("::");
    }
  }

  const adapter = adapterFor(sourceId);
  if (!adapter || !path) {
    return reportProblem({
      what: "No usable import source.",
      why: sourceId
        ? `"${sourceId}" is not a source this CLI can read, or the path is missing.`
        : "No path was given and nothing was detected automatically.",
      fix: [
        "vulcanus import --source chatgpt --path <export directory>",
        `Known sources: ${ADAPTERS.map((entry) => entry.id).join(", ")}`,
      ],
    });
  }

  // Conversations already scanned are skipped unless --all asks for a rescan.
  const ledger = await readSeen(vaultRoot, manifest);
  const previously = options.all ? new Set<string>() : seenIds(ledger, adapter.id);
  const encountered = new Set<string>();
  const stream = skipSeen(() => adapter.load(path), previously, encountered);

  const reading = p.spinner();
  reading.start(t.reading);
  let analysis;
  try {
    analysis = await analyzeConversations(stream);
  } catch (error) {
    reading.stop(t.readFailed((error as Error).message));
    return 1;
  }
  reading.stop(t.readDone(analysis.conversations, analysis.candidates.length));

  const skipped = encountered.size - analysis.conversations;
  if (skipped > 0) {
    p.log.info(
      `${skipped} conversation(s) were imported before and were skipped (--all re-reads them).`,
    );
  }

  if (options.json) {
    const known = new Set(manifest.projects.map((project) => project.name.toLowerCase()));
    process.stdout.write(
      `${JSON.stringify(
        {
          vault: manifest.vault.name,
          source: { id: adapter.id, label: adapter.label, path },
          conversations: analysis.conversations,
          skippedAsSeen: skipped > 0 ? skipped : 0,
          sources: analysis.sources,
          candidates: analysis.candidates.map((candidate) => ({
            ...candidate,
            alreadyInVault: known.has(candidate.name.toLowerCase()),
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const known = new Set(manifest.projects.map((project) => project.name.toLowerCase()));
  const shortlist = analysis.candidates
    .filter((candidate) => !known.has(candidate.name.toLowerCase()))
    .slice(0, 25);

  if (shortlist.length === 0) {
    p.outro("No new project candidates.");
    return 0;
  }

  const selected = await askMultiselect({
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
    initialValues: shortlist
      .filter((candidate) => candidate.evidence.explicitGroup)
      .map((candidate) => candidate.name),
  });

  if (selected.length === 0) {
    p.outro("Nothing selected.");
    return 0;
  }

  const requested: DetailMode = options.ai ? "ai" : await askDetailMode(locale);

  // Planned before anything is written, so a machine without an AI CLI falls
  // back to the questions instead of creating projects nobody described.
  const handoff =
    requested === "ai"
      ? await planHandoff(selected, locale, typeof options.ai === "string" ? options.ai : undefined)
      : null;
  const mode: DetailMode = requested === "ai" && !handoff ? "manual" : requested;

  const { projects, groups } = await collectProjectDetails(selected, manifest, locale, mode);

  const withRecord = {
    ...manifest,
    imports: [
      ...manifest.imports,
      {
        source: adapter.label,
        date: new Date().toISOString().slice(0, 10),
        conversations: analysis.conversations,
        candidatesAccepted: selected.length,
        note: "Raw conversations were read locally and never copied into the vault.",
      },
    ],
  };

  const spinner = p.spinner();
  spinner.start(t.generating);
  const result = await applyProjects(vaultRoot, withRecord, { projects, groups });
  spinner.stop(`${result.created.length} files written, ${result.patched.length} patched`);

  // Recorded only after the write succeeded: a failed import must be repeatable.
  await writeSeen(vaultRoot, manifest, rememberIds(ledger, adapter.id, encountered));

  const afterAi = handoff
    ? await runHandoff(vaultRoot, await readManifest(vaultRoot), handoff, locale)
    : null;
  const ok = afterAi ? afterAi.ok : result.ok;

  p.outro(ok ? "PASS" : "FAIL — see findings above");
  return ok ? 0 : 1;
}
