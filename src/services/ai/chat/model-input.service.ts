import type { TChatMessage } from "@/types/ai";
import { toMalaysiaIsoString } from "@/utils/date";

/**
 * The stored history as the model sees it; the client and `chat_message` keep
 * the original. The result must be identical on every request for the same
 * history, so a replayed conversation keeps hitting the prompt cache.
 *
 * - Each user message starts with the time it was sent (its own `savedAt`),
 *   so the system prompt stays fixed and "today" resolves correctly.
 * - Stored reasoning is dropped: Anthropic rejects a replayed thinking block
 *   once anything before it changes, e.g. when the history window moves.
 */
export function toModelHistory(messages: TChatMessage[]): TChatMessage[] {
  return messages.map((message) =>
    message.role === "user" ? withSentAt(message) : message,
  );
}

function withSentAt(message: TChatMessage): TChatMessage {
  const savedAt = message.metadata?.savedAt;
  if (!savedAt) return message;

  const sentAt = toMalaysiaIsoString(new Date(savedAt));
  return {
    ...message,
    parts: [{ type: "text", text: `[Sent ${sentAt}]` }, ...message.parts],
  };
}
