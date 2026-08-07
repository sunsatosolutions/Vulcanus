/**
 * Merging a generated file into the operator's version of it.
 *
 * `AGENTS.md` is the one file that has to be both: it is the protocol every
 * agent reads, so a new required step must reach existing vaults — and it is
 * also the file operators extend with instructions of their own, which a
 * regenerating writer used to delete. Merging keeps both true.
 *
 * The contract is deliberately blunt, because an agent-readable protocol is not
 * a place for clever three-way reconciliation:
 *
 * - **Sections you already have are yours.** An existing `## Heading` is kept
 *   verbatim, including any edits inside it.
 * - **Sections the protocol adds are inserted**, in the generated order,
 *   relative to the sections around them.
 * - **The protocol stamp is refreshed**, so `doctor` can tell what an agent is
 *   actually following.
 *
 * The cost is stated plainly in the CHANGELOG: wording improvements to a
 * section you have already customized will not reach you. Losing your
 * customization would be worse.
 */

export interface MarkdownSection {
  /** Heading text without the leading `## `; null for the preamble. */
  heading: string | null;
  /** The whole block, heading line included. */
  body: string;
}

/** Split on top-level `## ` headings, keeping everything before the first one. */
export function splitSections(text: string): MarkdownSection[] {
  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (heading === null && buffer.join("").trim() === "" && sections.length === 0) {
      // A file that starts with a heading has no preamble worth keeping.
      if (buffer.length === 0) return;
    }
    sections.push({ heading, body: buffer.join("\n") });
  };

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match && !line.startsWith("###")) {
      flush();
      heading = match[1];
      buffer = [line];
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * Keep the operator's file, add the sections it is missing, and refresh the
 * protocol stamp. Returns the merged text.
 */
export function mergeProtocol(existing: string, generated: string): string {
  const mine = splitSections(existing);
  const theirs = splitSections(generated);

  const have = new Map<string, number>();
  mine.forEach((section, index) => {
    if (section.heading !== null) have.set(section.heading, index);
  });

  // Walk the generated order, inserting anything missing after the last section
  // the two files agree on, so a new step lands where the protocol puts it.
  const merged = [...mine];
  let anchor = merged.findIndex((section) => section.heading !== null);
  if (anchor === -1) anchor = merged.length;

  for (const section of theirs) {
    if (section.heading === null) continue;
    const at = have.get(section.heading);
    if (at !== undefined) {
      anchor = at + 1;
      continue;
    }
    merged.splice(anchor, 0, section);
    // Everything after the insertion shifted by one.
    have.forEach((index, key) => {
      if (index >= anchor) have.set(key, index + 1);
    });
    have.set(section.heading, anchor);
    anchor += 1;
  }

  const text = merged.map((section) => section.body.replace(/\s+$/, "")).join("\n\n");
  return `${refreshStamp(text, generated)}\n`;
}

const STAMP = /<!--\s*vulcanus:protocol\s+\d+\s*-->/;

/**
 * Carry the generated protocol stamp into the merged file, adding it after the
 * title when the operator's copy predates stamping.
 */
function refreshStamp(text: string, generated: string): string {
  const stamp = STAMP.exec(generated)?.[0];
  if (!stamp) return text;
  if (STAMP.test(text)) return text.replace(STAMP, stamp);

  const lines = text.split("\n");
  const title = lines.findIndex((line) => line.startsWith("# "));
  if (title === -1) return `${stamp}\n\n${text}`;
  lines.splice(title + 1, 0, stamp);
  return lines.join("\n");
}
