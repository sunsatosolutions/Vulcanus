import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Read a JSONL file line by line, skipping unparsable lines. */
export async function* readJsonl(file: string): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") yield parsed as Record<string, unknown>;
      } catch {
        // Truncated or partially written sessions are common; skip the line.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Claude and Codex both use `string | Array<{type,text}>` for message content. */
export function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      chunks.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: string; text?: unknown };
    if (typeof record.text === "string" && /text/i.test(record.type ?? "text")) {
      chunks.push(record.text);
    }
  }
  return chunks.join("\n");
}
