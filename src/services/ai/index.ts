import { HTTP_STATUS } from "@/constants/error";
import { errorResponse, successResponse } from "@/libs/response";
import { addExpenseSchema } from "@/schemas/expense";
import { triageAgent } from "@/services/ai/agents/triage.agent";
import {
  ChatError,
  prepareTurn,
  saveMessage,
} from "@/services/ai/chat-history";
import { getCategories } from "@/services/ai/tools/expense.tools";
import type { TAiChat, TAiScan } from "@/types/ai";
import type { ValidContext } from "@/types/common";
import { getDateTimeNow } from "@/utils/date";
import { getModel } from "@/utils/model";
import * as ai from "ai";
import {
  consumeStream,
  createAgentUIStreamResponse,
  createIdGenerator,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { wrapAISDK } from "braintrust";

const { generateText } = wrapAISDK(ai);

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

/**
 * `POST /ai/chat`. The backend owns the conversation: the client sends only
 * the new user message (or approval decisions) and the history is loaded from
 * `chat_message`. The assistant reply is persisted when the stream ends, even
 * if the client disconnects mid-stream.
 */
export async function aiChat(c: ValidContext<TAiChat>) {
  const body = c.req.valid("json");
  const { supabase, supabaseAdmin } = c.var.supabaseContext;
  const { sessionId } = body;

  try {
    const agent = triageAgent(c);
    const messages = await prepareTurn(
      supabase,
      supabaseAdmin,
      body,
      agent.tools,
    );

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      originalMessages: messages,
      generateMessageId,
      messageMetadata: ({ part }) =>
        part.type === "finish"
          ? {
              usage: {
                inputTokens: part.totalUsage.inputTokens,
                outputTokens: part.totalUsage.outputTokens,
                totalTokens: part.totalUsage.totalTokens,
              },
            }
          : undefined,
      // Drain a copy of the stream so the run (and `onEnd`) completes even if
      // the client goes away.
      consumeSseStream: ({ stream }) =>
        c.executionCtx.waitUntil(consumeStream({ stream })),
      onEnd: ({ responseMessage }) => {
        if (responseMessage.parts.length === 0) return;
        c.executionCtx.waitUntil(
          saveMessage(supabaseAdmin, sessionId, responseMessage).catch(
            (error) => console.error("aiChat: saving reply failed:", error),
          ),
        );
      },
    });
  } catch (error) {
    if (error instanceof ChatError) {
      return errorResponse(c, {
        status: error.status,
        title: error.title,
        detail: error.detail,
      });
    }
    console.error("aiChat failed:", error);
    return errorResponse(c);
  }
}

/**
 * `POST /ai/scan`. Stateless receipt extraction: returns a proposed expense for
 * the client to review in its add-expense form. Nothing is written.
 */
export async function aiScan(c: ValidContext<TAiScan>) {
  const { url, mediaType } = c.req.valid("json");

  try {
    const categories = await getCategories(c);
    const { output } = await generateText({
      model: getModel({ c, provider: "gemini" }),
      output: Output.object({ schema: addExpenseSchema }),
      system: `Extract the single expense or income transaction shown in the receipt image.

    DateTime now:
    ${getDateTimeNow()}

    Categories (id, name, is_expense):
    ${JSON.stringify(categories)}

    Rules:
    - Use the receipt total as the amount.
    - Pick the best matching category id and set is_expense to match it.
    - Use the receipt date; fall back to the current datetime if none is visible.`.trim(),
      messages: [
        {
          role: "user",
          content: [{ type: "file", data: new URL(url), mediaType }],
        },
      ],
    });

    return successResponse(c, { data: output });
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      return errorResponse(c, {
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        title: "Could not read receipt",
      });
    }
    console.error("aiScan failed:", error);
    return errorResponse(c);
  }
}
