/**
 * Surgical Markdown edits for notes the operator owns. These never rewrite a
 * file wholesale — they insert exactly what is missing and leave the rest alone.
 */

/** Insert `bullet` under `heading`, creating the section if it does not exist. */
export function ensureBulletUnderHeading(
  content: string,
  heading: string,
  bullet: string,
): { content: string; changed: boolean } {
  if (content.includes(bullet)) return { content, changed: false };

  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading.trim());

  if (headingIndex === -1) {
    const trimmed = content.replace(/\s+$/, "");
    return { content: `${trimmed}\n\n${heading}\n\n${bullet}\n`, changed: true };
  }

  // Walk to the end of the section's bullet list.
  let cursor = headingIndex + 1;
  let lastBullet = -1;
  while (cursor < lines.length && !lines[cursor].startsWith("## ")) {
    if (lines[cursor].startsWith("- ")) lastBullet = cursor;
    cursor += 1;
  }

  if (lastBullet === -1) {
    lines.splice(headingIndex + 1, 0, "", bullet);
  } else {
    lines.splice(lastBullet + 1, 0, bullet);
  }

  return { content: lines.join("\n"), changed: true };
}

/**
 * Remove a whole section: the heading line plus everything up to the next
 * heading of the same or a higher level. `heading` carries its own hashes,
 * e.g. `### Meridian`.
 */
export function removeSection(
  content: string,
  heading: string,
): { content: string; changed: boolean } {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading.trim());
  if (start === -1) return { content, changed: false };

  const level = heading.match(/^#+/)?.[0].length ?? 3;
  let end = start + 1;
  while (end < lines.length) {
    const match = lines[end].match(/^(#+)\s/);
    if (match && match[1].length <= level) break;
    end += 1;
  }

  lines.splice(start, end - start);
  // Collapse the doubled blank line the removal can leave behind.
  while (start > 0 && lines[start - 1] === "" && lines[start] === "") lines.splice(start, 1);

  return { content: lines.join("\n"), changed: true };
}

/** Drop every bullet line that wikilinks to one of `names`. */
export function removeBulletsLinking(
  content: string,
  names: string[],
): { content: string; changed: boolean } {
  const targets = names.map((name) => `[[${name}]]`);
  const lines = content.split("\n");
  const kept = lines.filter(
    (line) => !(line.trimStart().startsWith("- ") && targets.some((t) => line.includes(t))),
  );
  return { content: kept.join("\n"), changed: kept.length !== lines.length };
}

/** Insert a full section before `beforeHeading`, or append it at the end. */
export function insertSectionBefore(
  content: string,
  beforeHeading: string,
  section: string,
): { content: string; changed: boolean } {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.trim() === beforeHeading.trim());

  if (index === -1) {
    const trimmed = content.replace(/\s+$/, "");
    return { content: `${trimmed}\n\n${section}\n`, changed: true };
  }

  lines.splice(index, 0, section, "");
  return { content: lines.join("\n"), changed: true };
}
