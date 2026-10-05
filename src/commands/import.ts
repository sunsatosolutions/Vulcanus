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
import type { AnalysisResult } from "../importers/analyze.js";
import type { NormalizedConversation } from "../importers/types.js";
import { readSeen, rememberIds, seenIds, skipSeen, writeSeen } from "../importers/seen.js";
import { messages, type Locale, type Messages } from "../i18n.js";
import { askConfirm, askMultiselect, askSelect, askText, setPromptLocale } from "../prompts.js";
import { planHandoff, runHandoff } from "../ai/handoff.js";
import { detectAiClis } from "../ai/clis.js";
import { buildDigest, mergeClusters, runClustering } from "../ai/cluster.js";
import { applyProjects, askDetailMode, collectProjectDetails, type DetailMode } from "./add.js";
import { noVaultProblem, reportProblem } from "../errors.js";
import { runDoctor } from "../doctor/index.js";
import { openVault } from "../mcp/tools.js";
import { findMemoryCandidates, runMemoryInbox } from "../memory/inbox.js";

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
   * Ask an installed AI CLI to group the conversations, alongside the
   * word-frequency pass. A string names the CLI. Opt-in, and confirmed again
   * before anything is sent: a digest of the history leaves the machine.
   */
  aiGroup?: string | boolean;
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
  /**
   * Look for decisions and rules the operator stated in the conversations and
   * offer them for review. `undefined` asks; `false` skips without asking.
   */
  memory?: boolean;
  /** Skip project discovery and only review memory for existing projects. */
  memoryOnly?: boolean;
  /**
   * Ask an installed AI CLI to merge, drop, and reword the memory candidates.
   * Opt-in, and confirmed again before the candidate sentences are sent.
   */
  aiExtract?: string | boolean;
}

/**
 * Ask an installed AI CLI to group the conversations, and fold what it says
 * into the heuristic result.
 *
 * Every failure here is survivable and none of them stop the import: no CLI on
 * PATH, the operator declining, a reply that is not JSON. The word-frequency
 * candidates were already computed, so the worst case is the import the
 * operator would have had anyway, with a line saying why.
 */
async function groupWithAi(
  analysis: AnalysisResult,
  load: () => AsyncIterable<NormalizedConversation>,
  choice: string | boolean,
  t: Messages,
): Promise<AnalysisResult> {
  const detected = detectAiClis();
  const cli =
    typeof choice === "string"
      ? detected.find((entry) => entry.id === choice || entry.command === choice)
      : detected[0];
  if (!cli) {
    p.log.warn(t.aiGroupNoCli);
    return analysis;
  }

  const conversations: NormalizedConversation[] = [];
  for await (const conversation of load()) conversations.push(conversation);
  const digest = buildDigest(conversations);
  if (digest.length === 0) return analysis;

  p.log.step(t.aiGroupTitle(cli.label));
  p.note(t.aiGroupSummary(cli.label, digest.length));
  if (!(await askConfirm({ message: t.aiGroupConfirm(cli.label), initialValue: true }))) {
    return analysis;
  }

  const spinner = p.spinner();
  spinner.start(t.aiGroupRunning(cli.label));
  const { clusters, error } = await runClustering(cli, digest);
  if (!clusters) {
    spinner.stop(t.aiGroupFailed(cli.label, error ?? ""));
    return analysis;
  }
  spinner.stop(t.aiGroupDone(clusters.length, cli.label));

  return mergeClusters(analysis, clusters);
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

  // The memory review keeps its own ledger: a conversation scanned for project
  // names has not been reviewed for decisions, and the reverse.
  const memorySeen = options.all ? new Set<string>() : seenIds(ledger, adapter.id, "memory");
  const memoryStream = skipSeen(() => adapter.load(path), memorySeen, new Set<string>());

  const reviewMemory = async (): Promise<boolean> => {
    const run = await runMemoryInbox({
      vaultRoot,
      load: memoryStream,
      source: adapter.id,
      aiExtract: options.aiExtract,
      t,
    });
    if (run.reviewedConversations.length) {
      const fresh = await readSeen(vaultRoot, manifest);
      await writeSeen(
        vaultRoot,
        manifest,
        rememberIds(fresh, adapter.id, run.reviewedConversations, "memory"),
      );
    }
    if (run.accepted === 0) return true;
    const report = await runDoctor(vaultRoot, await readManifest(vaultRoot));
    return report.ok;
  };

  // Asked once, after the project step, and never in JSON mode: accepting
  // memory is a review, not something to do unattended.
  const wantsMemory = async (): Promise<boolean> => {
    if (options.memoryOnly || options.memory) return true;
    if (options.memory === false || options.json) return false;
    return askConfirm({ message: t.memoryAsk, initialValue: false });
  };

  if (options.memoryOnly && options.json) {
    const found = await findMemoryCandidates(await openVault(vaultRoot), memoryStream());
    const perProject: Record<string, number> = {};
    for (const candidate of found.candidates) {
      perProject[candidate.project] = (perProject[candidate.project] ?? 0) + 1;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          vault: manifest.vault.name,
          source: { id: adapter.id, label: adapter.label, path },
          conversations: found.conversationIds.length,
          memoryCandidates: perProject,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (options.memoryOnly) {
    const ok = await reviewMemory();
    p.outro(ok ? "PASS" : "FAIL — run `vulcanus doctor` for details");
    return ok ? 0 : 1;
  }
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

  if (options.aiGroup) {
    analysis = await groupWithAi(analysis, () => adapter.load(path), options.aiGroup, t);
  }

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
    p.log.info("No new project candidates.");
    const ok = (await wantsMemory()) ? await reviewMemory() : true;
    p.outro(ok ? "Done." : "FAIL — run `vulcanus doctor` for details");
    return ok ? 0 : 1;
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
    p.log.info("No projects selected.");
    const ok = (await wantsMemory()) ? await reviewMemory() : true;
    p.outro(ok ? "Done." : "FAIL — run `vulcanus doctor` for details");
    return ok ? 0 : 1;
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
  const projectsOk = afterAi ? afterAi.ok : result.ok;
  // New projects exist in the manifest by now, so their conversations' decisions
  // have somewhere to go.
  const memoryOk = projectsOk && (await wantsMemory()) ? await reviewMemory() : true;
  const ok = projectsOk && memoryOk;

  p.outro(ok ? "PASS" : "FAIL — see findings above");
  return ok ? 0 : 1;
}
