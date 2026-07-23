import * as p from "@clack/prompts";
import { resolve } from "node:path";
import { findVaultRoot, readManifest } from "../manifest/io.js";
import {
  ADAPTERS,
  adapterFor,
  analyzeConversations,
  detectSources,
  type ImportSourceId,
} from "../importers/index.js";
import { messages, type Locale } from "../i18n.js";
import { askMultiselect, askSelect, askText, setPromptLocale } from "../prompts.js";
import { applyProjects, collectProjectDetails } from "./add.js";

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
}

export interface ImportOptions {
  cwd?: string;
  source?: ImportSourceId;
  path?: string;
}

export async function importCommand(options: ImportOptions = {}): Promise<number> {
  const vaultRoot = findVaultRoot(options.cwd ?? process.cwd());
  if (!vaultRoot) {
    process.stderr.write("No vulcanus.json found. Run `vulcanus init` first.\n");
    return 2;
  }

  const manifest = await readManifest(vaultRoot);
  const locale: Locale = manifest.vault.language === "tr" ? "tr" : "en";
  setPromptLocale(locale);
  const t = messages(locale);

  p.intro(`import — ${manifest.vault.name}`);
  p.log.info(t.importHint);

  let sourceId = options.source;
  let path = options.path ? resolve(options.path) : undefined;

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
    process.stderr.write("No usable import source.\n");
    return 2;
  }

  const reading = p.spinner();
  reading.start(t.reading);
  let analysis;
  try {
    analysis = await analyzeConversations(() => adapter.load(path!));
  } catch (error) {
    reading.stop(t.readFailed((error as Error).message));
    return 1;
  }
  reading.stop(t.readDone(analysis.conversations, analysis.candidates.length));

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

  const { projects, groups } = await collectProjectDetails(selected, manifest, locale);

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

  p.outro(result.ok ? "PASS" : "FAIL — see findings above");
  return result.ok ? 0 : 1;
}
