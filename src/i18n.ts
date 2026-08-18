export type Locale = "tr" | "en";

export interface Messages {
  introTitle: string;
  introBody: string;

  localeQuestion: string;
  localeTr: string;
  localeEn: string;

  importQuestion: string;
  importHint: string;
  importNone: string;
  importNoneHint: string;
  importCustom: string;
  importCustomHint: string;
  importPathQuestion: string;
  importSourceQuestion: string;
  detecting: string;
  detected: (count: number) => string;
  noSourcesFound: string;
  reading: string;
  readDone: (conversations: number, candidates: number) => string;
  readFailed: (message: string) => string;

  candidatesTitle: string;
  candidatesHint: string;
  candidateLabel: (name: string, conversations: number, confidence: string) => string;
  manualProjectsQuestion: string;
  manualProjectsHint: string;
  projectListQuestion: string;
  projectListHint: string;
  noProjects: string;

  vaultSection: string;
  vaultNameQuestion: string;
  vaultNameHint: string;
  vaultFullNameQuestion: string;
  vaultTaglineQuestion: string;
  namingQuestion: string;
  namingBranded: (vault: string) => string;
  namingGeneric: string;
  profileQuestion: string;
  profileCore: string;
  profileCoreHint: string;
  profileFull: string;
  profileFullHint: string;

  adminSection: string;
  adminNameQuestion: string;
  adminRoleQuestion: string;
  adminRoleHint: string;
  adminAliasesQuestion: string;
  adminAliasesHint: string;

  detailModeQuestion: string;
  detailModeSkip: string;
  detailModeSkipHint: string;
  detailModeManual: string;
  detailModeManualHint: string;
  detailModeAi: string;
  detailModeAiHint: string;

  aiStructureNote: string;
  summaryAiHint: string;
  aiDetecting: string;
  aiDetected: (count: number) => string;
  aiNoneDetected: string;
  aiNoneHint: string;
  aiCliQuestion: string;
  aiCliUnknown: (name: string) => string;
  aiScanning: string;
  aiScanned: (count: number) => string;
  aiSourceQuestion: (name: string) => string;
  aiSourceHint: string;
  aiSourceOther: string;
  aiSourceSkip: string;
  aiSourceMissing: (path: string) => string;
  aiSkipped: (name: string) => string;
  aiHandoffTitle: (name: string) => string;
  aiHandoffSummary: (cli: string, dir: string, files: string[]) => string;
  aiHandoffConfirm: (cli: string) => string;
  aiSessionExited: (cli: string, code: number) => string;
  aiRevalidating: (name: string) => string;

  projectSection: (name: string) => string;
  summaryQuestion: (name: string) => string;
  parentQuestion: (name: string) => string;
  parentNone: string;
  groupQuestion: (name: string) => string;
  groupNone: string;
  groupNew: string;
  groupNameQuestion: string;
  specializedQuestion: (name: string) => string;
  triggersQuestion: (name: string) => string;
  triggersHint: string;
  kindQuestion: (name: string) => string;
  kindUnset: string;
  visibilityQuestion: (name: string) => string;
  visibilityPublic: string;
  visibilityPrivate: string;

  targetQuestion: string;
  targetHint: string;
  existingVaultQuestion: string;
  existingVaultLabel: (path: string) => string;
  existingVaultHint: string;
  existingVaultNew: string;
  existingVaultNewHint: string;
  continuingInVault: (path: string) => string;
  derivedIdentity: (vault: string, admin: string) => string;
  alreadyVulcanus: (path: string) => string;
  alreadyVulcanusHint: string;
  gitQuestion: string;
  overwriteWarning: (path: string) => string;
  confirmQuestion: (files: number, path: string) => string;

  generating: string;
  validating: string;
  doctorPassed: (files: number, links: number) => string;
  doctorFailed: (errors: number) => string;

  skillsExplain: string;
  skillsInVault: (count: number) => string;
  skillsInstallHint: string;
  skillsInstalled: (count: number, path: string) => string;
  skillsKept: (count: number) => string;
  skillsForceHint: string;
  skillsOutro: string;

  cancelled: string;
  summaryTitle: string;
  nextSteps: (path: string) => string;
  required: string;
}

import en from "./locales/en.json" with { type: "json" };
import tr from "./locales/tr.json" with { type: "json" };

/**
 * Catalogs live in JSON, one file per locale, so a translator edits data
 * instead of TypeScript and a new language is a file rather than a patch.
 *
 * The interface above stays the source of truth for what a catalog must
 * contain and which of its entries take arguments; a test asserts every locale
 * matches it, which is what keeps a half-translated file from reaching a user
 * as an empty prompt.
 */
const CATALOGS: Record<Locale, Record<string, string>> = { en, tr };

/**
 * Parameter order for the entries the interface declares as functions. The
 * names double as the placeholders a template writes, so a translator can move
 * `{name}` anywhere the target language needs it and reorder nothing in code.
 */
const PARAMETERS: Record<string, string[]> = {
  detected: ["count"],
  readDone: ["conversations", "candidates"],
  readFailed: ["message"],
  candidateLabel: ["name", "conversations", "confidence"],
  namingBranded: ["vault"],
  aiDetected: ["count"],
  aiCliUnknown: ["name"],
  aiScanned: ["count"],
  aiSourceQuestion: ["name"],
  aiSourceMissing: ["path"],
  aiSkipped: ["name"],
  aiHandoffTitle: ["name"],
  aiHandoffSummary: ["cli", "dir", "files"],
  aiHandoffConfirm: ["cli"],
  aiSessionExited: ["cli", "code"],
  aiRevalidating: ["name"],
  projectSection: ["name"],
  summaryQuestion: ["name"],
  parentQuestion: ["name"],
  groupQuestion: ["name"],
  specializedQuestion: ["name"],
  triggersQuestion: ["name"],
  kindQuestion: ["name"],
  visibilityQuestion: ["name"],
  existingVaultLabel: ["path"],
  continuingInVault: ["path"],
  derivedIdentity: ["vault", "admin"],
  alreadyVulcanus: ["path"],
  overwriteWarning: ["path"],
  confirmQuestion: ["files", "path"],
  doctorPassed: ["files", "links"],
  doctorFailed: ["errors"],
  skillsInVault: ["count"],
  skillsInstalled: ["count", "path"],
  skillsKept: ["count"],
  nextSteps: ["path"],
};

/** Replace `{name}` with its value; an unknown placeholder is left visible. */
function fill(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

function build(locale: Locale): Messages {
  const catalog = CATALOGS[locale];
  const built: Record<string, unknown> = {};

  for (const [key, template] of Object.entries(catalog)) {
    const names = PARAMETERS[key];
    if (!names) {
      built[key] = template;
      continue;
    }
    built[key] = (...args: unknown[]) => {
      const values: Record<string, unknown> = {};
      names.forEach((name, index) => {
        const value = args[index];
        // A list is formatted here rather than in the template: indentation is
        // layout, not language, and no translator should have to reproduce it.
        values[name] = Array.isArray(value)
          ? value.map((entry) => `  ${String(entry)}`).join("\n")
          : value;
      });
      return fill(template, values);
    };
  }

  return built as unknown as Messages;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: build("en"),
  tr: build("tr"),
};

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** Every key the interface declares, for the completeness test. */
export const MESSAGE_KEYS: string[] = Object.keys(CATALOGS.en);

/** Keys that take arguments, mapped to their parameter names in order. */
export const MESSAGE_PARAMETERS: Readonly<Record<string, string[]>> = PARAMETERS;
