import type { Locale } from "../i18n.js";
import deNotes from "../locales/notes/de.json" with { type: "json" };
import enNotes from "../locales/notes/en.json" with { type: "json" };
import esNotes from "../locales/notes/es.json" with { type: "json" };
import trNotes from "../locales/notes/tr.json" with { type: "json" };

/**
 * The prose the generator writes into a vault, in the operator's language.
 *
 * Two catalogs rather than one, because the two halves are used differently.
 * `text` is what a reader reads and nothing else depends on its wording.
 * `headings` name the sections a hub lists what it owns under, and `wireHubs`
 * inserts into them while `doctor` reads them — so a heading is looked up by
 * its English name from both the generator and the checker, and translating one
 * cannot leave the other looking in the wrong place.
 *
 * A key missing from a locale falls back to English rather than rendering
 * empty: a half-translated catalog should read oddly, not silently produce a
 * note with a hole in it.
 */
export interface NoteCatalog {
  headings: Record<string, string>;
  text: Record<string, string>;
}

const CATALOGS: Record<Locale, NoteCatalog> = {
  en: enNotes,
  tr: trNotes,
  de: deNotes,
  es: esNotes,
};

function fill(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export interface NoteText {
  /** Localized prose for `key`, with `{name}` placeholders filled from `values`. */
  (key: string, values?: Record<string, unknown>): string;
  /** The `## ` heading line for the section English calls `name`. */
  heading(name: string): string;
  /** The heading's text without the `## ` prefix, for prose that names a section. */
  headingText(name: string): string;
}

export function noteText(locale: Locale): NoteText {
  const catalog = CATALOGS[locale] ?? CATALOGS.en;

  const text = ((key: string, values: Record<string, unknown> = {}) => {
    const template = catalog.text[key] ?? CATALOGS.en.text[key];
    if (template === undefined) throw new Error(`No generated-note text for "${key}"`);
    return fill(template, values);
  }) as NoteText;

  text.headingText = (name: string) => catalog.headings[name] ?? CATALOGS.en.headings[name] ?? name;
  text.heading = (name: string) => `## ${text.headingText(name)}`;

  return text;
}

/**
 * Keys that stay English in every locale, on purpose.
 *
 * These are read by agents, not by the operator: the AGENTS.md protocol and the
 * visibility rule inside it. The protocol carries a version stamp that `doctor`
 * checks and that `update` merges against, so one shape in one language is the
 * thing that keeps those checks honest — and model instructions are followed
 * more reliably in the language they were written in. A test holds every locale
 * to the English text for these, so translating one is a failure rather than a
 * surprise in a generated vault.
 */
export const ENGLISH_ONLY_PREFIXES = [
  "root.agentsFile.",
  "root.projectVisibilitySection.",
  "root.gitignoreFile.",
];

/** Whether `key` is one of the entries that deliberately stays English. */
export function isEnglishOnly(key: string): boolean {
  return ENGLISH_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Every heading name the catalogs define, for tests and for `derive.ts`. */
export const HEADING_NAMES: string[] = Object.keys(enNotes.headings);

/**
 * Every spelling a section heading has, the vault's own language first.
 *
 * The order carries meaning. `wireHubs` inserts a missing link under the first
 * entry, so that one has to be the heading this vault actually writes. The
 * doctor accepts any of them, which is what keeps a vault validating after its
 * language changes, and what keeps vaults written before the headings were
 * translated from turning into findings.
 */
export function headingVariants(name: string, locale: Locale): string[] {
  const ordered = [CATALOGS[locale] ?? CATALOGS.en, CATALOGS.en, ...Object.values(CATALOGS)];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const catalog of ordered) {
    const heading = `## ${catalog.headings[name] ?? name}`;
    if (seen.has(heading)) continue;
    seen.add(heading);
    variants.push(heading);
  }
  return variants;
}
