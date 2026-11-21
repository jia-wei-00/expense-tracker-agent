import { sortKeys, toJson } from "@/utils/json";

/**
 * A tool result as the model sees it, keys sorted. Replayed history comes from
 * `chat_message` (`jsonb`, which reorders keys), and Anthropic rejects a
 * thinking block once an earlier tool result's text changes, so the live run
 * and every replay must render the same text.
 */
export const toModelOutput = ({ output }: { output: unknown }) => ({
  type: "json" as const,
  value: sortKeys(toJson(output)),
});
