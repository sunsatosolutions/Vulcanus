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
