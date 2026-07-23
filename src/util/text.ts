const TRANSLITERATE: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
  é: "e",
  É: "e",
  ñ: "n",
  ß: "ss",
};

const COMBINING_MARKS = /[̀-ͯ]/g;

/** ASCII slug that survives Turkish and accented characters. */
export function slugify(value: string): string {
  const mapped = Array.from(value)
    .map((char) => TRANSLITERATE[char] ?? char)
    .join("");
  return mapped
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Filesystem-safe note or folder name that still reads like the display name. */
export function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function titleFromPath(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.md$/i, "");
}

/** Markdown bullet list, or a placeholder line when there is nothing to list. */
export function bulletList(items: string[], emptyLine = "_None recorded yet._"): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return emptyLine;
  return cleaned.map((item) => `- ${item}`).join("\n");
}

/** Collapse a body into the blank-line-separated form the vault notes use. */
export function joinSections(sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => (section ?? "").trimEnd())
    .filter((section) => section.length > 0)
    .join("\n\n")
    .concat("\n");
}

export function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}
