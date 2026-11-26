import type { VaultManifest } from "../manifest/schema.js";

/** Letters that read as Latin ones (Cyrillic, Greek, dotless i, long s); the rest are dropped as non-Latin. */
const LOOKALIKE: Record<string, string> = {
  а: "a",
  в: "b",
  с: "c",
  ԁ: "d",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ı: "i",

  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  γ: "y",
};

function decode(text: string): string {
  return text
    .replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return " ";
      }
    })
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
      const point = code[0] === "x" || code[0] === "X" ? parseInt(code.slice(1), 16) : Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&[a-z][a-z0-9]*;/gi, " ");
}

/** Letters and digits only, folded: what a reader sees once markup and disguise are set aside. */
export function squash(text: string): string {
  return text
    .replace(/ſ/g, "l")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[Ͱ-ϿЀ-ӿı]/g, (char) => LOOKALIKE[char] ?? char)
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const forms = (text: string) => {
  const decoded = decode(text);
  return [squash(decoded), squash(decode(text.replace(/<[^>\n]*>/g, "")))];
};

const reverse = (text: string) => [...text].reverse().join("");

/** A project is private when it is marked so or sits under one that is: visibility is not inherited by the data. */
export function isPrivate(manifest: VaultManifest, id: string): boolean {
  const seen = new Set<string>();
  let current = manifest.projects.find((project) => project.id === id);
  while (current && !seen.has(current.id)) {
    if (current.visibility === "private") return true;
    seen.add(current.id);
    current = manifest.projects.find((project) => project.id === current!.parent);
  }
  return false;
}

/**
 * Whether `text` names one of `names`: written whole, split by spaces, markup or
 * entities, with lookalike letters, reversed, or with every word of it present.
 */
export function nameMatcher(names: string[]): (text: string) => boolean {
  const entries = names
    .map((name) => ({
      flat: squash(name),
      words: [...new Set(name.split(/[^\p{L}\p{N}]+/u).map(squash))].filter((w) => w.length >= 3),
    }))
    .filter((entry) => entry.flat !== "");
  return (text) => {
    const variants = forms(text);
    return entries.some(({ flat, words }) =>
      variants.some(
        (variant) =>
          variant.includes(flat) ||
          reverse(variant).includes(flat) ||
          (words.length >= 2 && words.every((word) => variant.includes(word))),
      ),
    );
  };
}

/** Flags every line that belongs to a name written across up to three lines. */
export function leakyLines(lines: string[], leaks: (text: string) => boolean): boolean[] {
  const flags = lines.map(() => false);
  const span = (from: number, to: number) => lines.slice(from, to).join("\n");
  for (let size = 1; size <= 3; size++) {
    for (let from = 0; from + size <= lines.length; from++) {
      if (!leaks(span(from, from + size))) continue;
      if (size > 1 && (leaks(span(from, from + size - 1)) || leaks(span(from + 1, from + size))))
        continue;
      for (let index = from; index < from + size; index++) flags[index] = true;
    }
  }
  return flags;
}
