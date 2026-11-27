import { maskSecrets } from "../secrets/detector.js";
import type { NormalizedConversation } from "./types.js";

/**
 * Every text field of a conversation with known-pattern secrets replaced by
 * `‹secret:<kind>›`. Applied where conversations enter the pipeline, so the
 * analysis, the candidate list, `--json`, the seen ledger, the AI digests and
 * the notes only ever see the masked text.
 */
export function maskConversation(conversation: NormalizedConversation): NormalizedConversation {
  const mask = (text: string) => maskSecrets(text).text;
  return {
    ...conversation,
    id: mask(conversation.id),
    title: mask(conversation.title),
    group: conversation.group === undefined ? undefined : mask(conversation.group),
    messages: conversation.messages.map((message) => ({ ...message, text: mask(message.text) })),
  };
}

export async function* maskedStream(
  stream: AsyncIterable<NormalizedConversation>,
): AsyncGenerator<NormalizedConversation> {
  for await (const conversation of stream) yield maskConversation(conversation);
}
