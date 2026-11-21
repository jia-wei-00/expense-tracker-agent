import { toModelHistory } from "@/services/ai/chat/model-input.service";
import type { chatAgent } from "@/services/ai/agents/chat.agent";
import type { TChatMessage, TChatMessageMetadata } from "@/types/ai";
import { createAgentUIStream, createIdGenerator, readUIMessageStream } from "ai";
import type { TextStreamPart, ToolSet } from "ai";

export const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

/** Attaches token usage to the assistant message once the stream finishes. */
export function usageMetadata({
  part,
}: {
  part: TextStreamPart<ToolSet>;
}): TChatMessageMetadata | undefined {
  return part.type === "finish"
    ? {
        usage: {
          inputTokens: part.totalUsage.inputTokens,
          outputTokens: part.totalUsage.outputTokens,
          totalTokens: part.totalUsage.totalTokens,
        },
      }
    : undefined;
}

/**
 * Runs the agent outside an HTTP response (Telegram) and returns the reply as
 * it should be stored. The options mirror `aiChat`, so the model sees the same
 * history and the stored reply has the same shape on both channels.
 *
 * A stream error throws instead of ending the reply early, so the caller can
 * retry the turn from the stored user message.
 */
export async function runAgent({
  agent,
  messages,
}: {
  agent: ReturnType<typeof chatAgent>;
  messages: TChatMessage[];
}): Promise<TChatMessage | undefined> {
  const stream = await createAgentUIStream({
    agent,
    uiMessages: toModelHistory(messages),
    originalMessages: messages,
    generateMessageId,
    messageMetadata: usageMetadata,
  });

  // An approval continuation extends the last assistant message, as `onEnd`
  // does for the app; a new turn starts an empty one.
  const last = messages.at(-1);
  let reply: TChatMessage | undefined;
  for await (const message of readUIMessageStream<TChatMessage>({
    message: last?.role === "assistant" ? last : undefined,
    stream,
    terminateOnError: true,
  })) {
    reply = message;
  }
  return reply;
}
