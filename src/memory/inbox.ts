/**
 * The memory inbox: turn decisions and rules the operator already stated in
 * their conversations into vault memory, one reviewed item at a time.
 *
 * Candidates live only in memory for the review. Nothing reaches a note until
 * the operator accepts it, and then only in the wording they accepted. Skipped
 * candidates are gone; the seen ledger keeps a reviewed conversation from
 * proposing them again.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as p from "../ui.js";
import { detectAiClis } from "../ai/clis.js";
import { applyExtracted, buildExtractDigest, runExtraction } from "../ai/extract.js";
import type { Messages } from "../i18n.js";
import type { ImportSourceId, NormalizedConversation } from "../importers/types.js";
import {
  appendDecision,
  appendRule,
  LifecycleTargetError,
  matchProject,
  openVault,
  type VaultHandle,
} from "../mcp/tools.js";
import { askConfirm, askSelect, askText } from "../prompts.js";
import {
  compareWithVault,
  existingSections,
  hitsIn,
  rankCandidates,
  suggestTitle,
  type ExistingSection,
  type MemoryCandidate,
  type SentenceHit,
} from "./extract.js";
import { parseSections, sectionState, today } from "./lifecycle.js";

/**
 * Which project a conversation is about: the grouping its source recorded
 * first, then its title. Body text is not used — a passing mention of a
 * project in a long conversation does not make its decisions that project's.
 */
export function projectOf(
  handle: VaultHandle,
  conversation: NormalizedConversation,
): string | undefined {
  const byGroup = conversation.group ? matchProject(handle.plan, conversation.group) : undefined;
  if (byGroup) return byGroup.project.name;
  if (conversation.syntheticTitle || !conversation.title) return undefined;
  return matchProject(handle.plan, conversation.title)?.project.name;
}

export interface FindResult {
  candidates: MemoryCandidate[];
  /** Conversations read, including those that produced nothing. */
  conversationIds: string[];
}

/** Read the stream once and return the ranked, vault-checked candidates. */
export async function findMemoryCandidates(
  handle: VaultHandle,
  conversations: AsyncIterable<NormalizedConversation>,
  now: number = Date.now(),
): Promise<FindResult> {
  const hits: SentenceHit[] = [];
  const conversationIds: string[] = [];
  for await (const conversation of conversations) {
    conversationIds.push(conversation.id);
    const project = projectOf(handle, conversation);
    if (project) hits.push(...hitsIn(conversation, project));
  }
  const ranked = rankCandidates(hits, now);
  return {
    candidates: compareWithVault(ranked, await vaultSections(handle)),
    conversationIds,
  };
}

async function vaultSections(handle: VaultHandle): Promise<Map<string, ExistingSection[]>> {
  const on = today();
  const live = (section: Parameters<typeof sectionState>[0]) =>
    sectionState(section, on) === "live";
  const byProject = new Map<string, ExistingSection[]>();
  for (const project of handle.plan.allProjects) {
    const sections: ExistingSection[] = [];
    for (const [note, kind] of [
      [project.decisions, "decision"],
      [project.rules, "rule"],
    ] as const) {
      const path = resolve(handle.vaultRoot, note.path);
      if (!existsSync(path)) continue;
      sections.push(...existingSections(note.path, await readFile(path, "utf8"), kind, live));
    }
    byProject.set(project.project.name, sections);
  }
  return byProject;
}

/**
 * Optional pass through an installed AI CLI. Every failure leaves the local
 * candidates untouched; the operator is shown what leaves the machine first.
 */
async function tidyWithAi(
  handle: VaultHandle,
  candidates: MemoryCandidate[],
  choice: string | boolean,
  t: Messages,
): Promise<MemoryCandidate[]> {
  const detected = detectAiClis();
  const cli =
    typeof choice === "string"
      ? detected.find((entry) => entry.id === choice || entry.command === choice)
      : detected[0];
  if (!cli) {
    p.log.warn(t.aiGroupNoCli);
    return candidates;
  }

  const digest = buildExtractDigest(candidates);
  p.log.step(t.memoryAiTitle(cli.label));
  p.note(t.memoryAiSummary(cli.label, digest.length));
  if (!(await askConfirm({ message: t.memoryAiConfirm(cli.label), initialValue: true }))) {
    return candidates;
  }

  const spinner = p.spinner();
  spinner.start(t.memoryAiRunning(cli.label));
  const { entries, error } = await runExtraction(cli, digest);
  if (!entries) {
    spinner.stop(t.memoryAiFailed(cli.label, error ?? ""));
    return candidates;
  }
  const tidied = applyExtracted(candidates, entries);
  spinner.stop(t.memoryAiDone(tidied.length, cli.label));
  // Reworded text is checked against the vault again: a rephrase can turn out
  // to be something the vault already records.
  return compareWithVault(tidied, await vaultSections(handle));
}

type Action = "decision" | "replace" | "rule" | "edit" | "skip" | "stop";

export interface ReviewOutcome {
  accepted: number;
  skipped: number;
  /** The operator stopped before the end; unreviewed candidates stay unseen. */
  stopped: boolean;
  written: string[];
}

async function headingsIn(handle: VaultHandle, path: string): Promise<Set<string>> {
  const absolute = resolve(handle.vaultRoot, path);
  if (!existsSync(absolute)) return new Set();
  const sections = parseSections(path, await readFile(absolute, "utf8"));
  return new Set(sections.map((section) => section.heading.toLowerCase()));
}

/** Walk the operator through each candidate and write what they accept. */
export async function reviewCandidates(
  handle: VaultHandle,
  candidates: MemoryCandidate[],
  source: ImportSourceId,
  t: Messages,
): Promise<ReviewOutcome> {
  const outcome: ReviewOutcome = { accepted: 0, skipped: 0, stopped: false, written: [] };

  for (const candidate of candidates) {
    const project = matchProject(handle.plan, candidate.project);
    if (!project) continue;

    let text = candidate.text;
    const date = candidate.lastSeen ? today(new Date(candidate.lastSeen)) : "—";
    const kindLabel = candidate.kind === "decision" ? t.memoryKindDecision : t.memoryKindRule;
    let action: Action;

    for (;;) {
      p.note(
        [
          `"${text}"`,
          ...(candidate.replaces ? [t.memoryMayReplace(candidate.replaces.heading)] : []),
        ].join("\n"),
        t.memoryCandidateTitle(candidate.project, kindLabel, candidate.conversations, date),
      );
      action = await askSelect<Action>({
        message: t.memoryAction,
        options: [
          ...(candidate.replaces
            ? [
                {
                  value: "replace" as const,
                  label: t.memoryAcceptReplace(candidate.replaces.heading),
                },
              ]
            : []),
          { value: "decision", label: t.memoryAcceptDecision },
          { value: "rule", label: t.memoryAcceptRule },
          { value: "edit", label: t.memoryEdit },
          { value: "skip", label: t.memorySkip },
          { value: "stop", label: t.memoryStop },
        ],
        initialValue: candidate.replaces ? "replace" : candidate.kind,
      });
      if (action !== "edit") break;
      text =
        (await askText({ message: t.memoryEditText, initialValue: text, required: true })).trim() ||
        text;
    }

    if (action === "stop") {
      outcome.stopped = true;
      break;
    }
    if (action === "skip") {
      outcome.skipped += 1;
      continue;
    }

    const asRule = action === "rule";
    const note = asRule ? project.rules : project.decisions;
    const suggested = suggestTitle(text, await headingsIn(handle, note.path));
    const title =
      (
        await askText({ message: t.memoryEditTitle, initialValue: suggested, required: true })
      ).trim() || suggested;
    const provenance = `import · ${source} · ${date === "—" ? today() : date}`;
    const supersedes =
      action === "replace" && candidate.replaces?.path === note.path
        ? candidate.replaces.heading
        : undefined;

    const write = (replace: string | undefined) =>
      asRule
        ? appendRule(handle, candidate.project, title, text, {
            source: provenance,
            supersedes: replace,
          })
        : appendDecision(handle, candidate.project, title, text, undefined, {
            source: provenance,
            supersedes: replace,
          });

    try {
      await write(supersedes);
    } catch (error) {
      if (!(error instanceof LifecycleTargetError)) throw error;
      p.log.warn(t.memorySupersedeFailed(supersedes ?? "", error.message));
      await write(undefined);
    }
    outcome.accepted += 1;
    if (!outcome.written.includes(note.path)) outcome.written.push(note.path);
  }

  return outcome;
}

export interface InboxRun extends ReviewOutcome {
  found: number;
  /** Conversations that may be marked reviewed; empty when the review stopped early. */
  reviewedConversations: string[];
}

/** Find, optionally tidy, and review memory candidates for an existing vault. */
export async function runMemoryInbox(options: {
  vaultRoot: string;
  load: () => AsyncIterable<NormalizedConversation>;
  source: ImportSourceId;
  aiExtract?: string | boolean;
  t: Messages;
}): Promise<InboxRun> {
  const { t } = options;
  const handle = await openVault(options.vaultRoot);
  const empty: InboxRun = {
    found: 0,
    accepted: 0,
    skipped: 0,
    stopped: false,
    written: [],
    reviewedConversations: [],
  };

  if (handle.plan.allProjects.length === 0) {
    p.log.warn(t.memoryNoProjects);
    return empty;
  }

  const spinner = p.spinner();
  spinner.start(t.memoryReading);
  const found = await findMemoryCandidates(handle, options.load());
  let candidates = found.candidates;
  spinner.stop(
    candidates.length
      ? t.memoryFound(candidates.length, new Set(candidates.map((entry) => entry.project)).size)
      : t.memoryNone,
  );

  if (candidates.length && options.aiExtract) {
    candidates = await tidyWithAi(handle, candidates, options.aiExtract, t);
  }
  if (candidates.length === 0) {
    return { ...empty, reviewedConversations: found.conversationIds };
  }

  const outcome = await reviewCandidates(handle, candidates, options.source, t);
  p.log.success(t.memoryDone(outcome.accepted, outcome.skipped));
  return {
    ...outcome,
    found: candidates.length,
    reviewedConversations: outcome.stopped ? [] : found.conversationIds,
  };
}
