import { toModelHistory } from "@/services/ai/chat/model-input.service";
import type {
  TChatAgent,
  TChatMessage,
  TChatMessageMetadata,
  TModelInputTransform,
  TReplySnapshotHandler,
} from "@/types/ai";
import { createAgentUIStream, createIdGenerator, readUIMessageStream } from "ai";
import type { TextStreamPart, ToolSet, UIMessageChunk } from "ai";

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
 * Reads a UI message stream into the reply, calling `onSnapshot` with every
 * snapshot as it arrives. A continuation passes the assistant `message` it
 * extends; it is copied, because the SDK grows the message it is given in place.
 *
 * A stream error throws once the stream has ended, so every snapshot before
 * it still reaches `onSnapshot` (an early abort would discard queued ones).
 */
export async function readReply({
  stream,
  message,
  onSnapshot,
}: {
  stream: ReadableStream<UIMessageChunk>;
  message?: TChatMessage;
  onSnapshot?: TReplySnapshotHandler;
}): Promise<TChatMessage | undefined> {
  const errors: unknown[] = [];
  let reply: TChatMessage | undefined;
  for await (const snapshot of readUIMessageStream<TChatMessage>({
    message: message && structuredClone(message),
    stream,
    onError: (error) => errors.push(error),
  })) {
    reply = snapshot;
    await onSnapshot?.(snapshot);
  }
  const [error] = errors;
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error("agent stream failed", { cause: error });
  }
  return reply;
}

/**
 * Runs the agent outside an HTTP response (Telegram) and returns the reply as
 * it should be stored. The options mirror `aiChat`, so the model sees the same
 * history and the stored reply has the same shape on both channels.
 *
 * A stream error throws instead of ending the reply early, so the caller can
 * retry the turn from the stored history. `onSnapshot` lets the caller store
 * progress first (see `readReply`).
 *
 * `prepareModelInput` rewrites only what the model sees (e.g. inlining files);
 * `originalMessages` and the stored reply keep the history as stored.
 */
export async function runAgent({
  agent,
  messages,
  prepareModelInput,
  onSnapshot,
}: {
  agent: TChatAgent;
  messages: TChatMessage[];
  prepareModelInput?: TModelInputTransform;
  onSnapshot?: TReplySnapshotHandler;
}): Promise<TChatMessage | undefined> {
  const modelHistory = toModelHistory(messages);
  const stream = await createAgentUIStream({
    agent,
    uiMessages: prepareModelInput ? await prepareModelInput(modelHistory) : modelHistory,
    originalMessages: messages,
    generateMessageId,
    messageMetadata: usageMetadata,
  });

  // An approval continuation extends the last assistant message, as `onEnd`
  // does for the app; a new turn starts an empty one.
  const last = messages.at(-1);
  return readReply({
    stream,
    message: last?.role === "assistant" ? last : undefined,
    onSnapshot,
  });
}
