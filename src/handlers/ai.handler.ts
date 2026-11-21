import { HTTP_STATUS } from "@/constants/error";
import { errorResponse, successResponse } from "@/libs/response";
import { chatAgent } from "@/services/ai/agents/chat.agent";
import { ChatError } from "@/services/ai/chat/chat.error";
import { saveMessage } from "@/services/ai/chat/message.service";
import { toModelHistory } from "@/services/ai/chat/model-input.service";
import { generateMessageId, usageMetadata } from "@/services/ai/chat/run.service";
import { prepareTurn } from "@/services/ai/chat/turn.service";
import { scanReceipt } from "@/services/ai/scan/scan.service";
import { createLedger } from "@/services/ledger/ledger.service";
import { consumeAiUsage } from "@/services/subscription/usage.service";
import type { TAiChat, TAiScan } from "@/types/ai";
import type { TValidContext } from "@/types/common";
import {
  consumeStream,
  createAgentUIStreamResponse,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
} from "ai";
import type { Context } from "hono";

/** The problem+json response for a request-level `ChatError`. */
function chatErrorResponse(c: Context, error: ChatError) {
  return errorResponse(c, {
    status: error.status,
    title: error.title,
    detail: error.detail,
    extensions: error.extensions,
  });
}

/**
 * `POST /ai/chat`. The backend owns the conversation: the client sends only
 * the new user message (or approval decisions) and the history is loaded from
 * `chat_message`. The assistant reply is persisted when the stream ends, even
 * if the client disconnects mid-stream.
 */
export async function aiChat(c: TValidContext<TAiChat>) {
  const body = c.req.valid("json");
  const { supabase, supabaseAdmin, userClaims } = c.var.supabaseContext;
  const { sessionId } = body;

  try {
    if (!userClaims)
      throw new ChatError(HTTP_STATUS.UNAUTHORIZED, "Not authenticated");
    const ledger = createLedger({
      db: supabase,
      kv: c.env.CACHE,
      userId: userClaims.id,
    });
    const agent = chatAgent({ env: c.env, ledger, channel: "app" });
    const messages = await prepareTurn(
      supabase,
      supabaseAdmin,
      userClaims.id,
      body,
      agent.tools,
    );

    return await createAgentUIStreamResponse({
      agent,
      uiMessages: toModelHistory(messages),
      originalMessages: messages,
      generateMessageId,
      messageMetadata: usageMetadata,
      // Drain a copy of the stream so the run (and `onEnd`) completes even if
      // the client goes away.
      consumeSseStream: ({ stream }) =>
        c.executionCtx.waitUntil(consumeStream({ stream })),
      onEnd: ({ responseMessage }) => {
        if (responseMessage.parts.length === 0) return;
        c.executionCtx.waitUntil(
          saveMessage(supabaseAdmin, sessionId, responseMessage).catch(
            (error: unknown) =>
              console.error("aiChat: saving reply failed:", error),
          ),
        );
      },
    });
  } catch (error) {
    if (error instanceof ChatError) return chatErrorResponse(c, error);
    console.error("aiChat failed:", error);
    return errorResponse(c);
  }
}

/**
 * `POST /ai/scan`. Stateless receipt extraction: returns proposed expense rows,
 * one per category, for the client to review. Nothing is written.
 */
export async function aiScan(c: TValidContext<TAiScan>) {
  const { supabase, supabaseAdmin, userClaims } = c.var.supabaseContext;

  try {
    if (!userClaims)
      throw new ChatError(HTTP_STATUS.UNAUTHORIZED, "Not authenticated");
    await consumeAiUsage(supabaseAdmin, userClaims.id, "scan");
    const ledger = createLedger({
      db: supabase,
      kv: c.env.CACHE,
      userId: userClaims.id,
    });
    const expenses = await scanReceipt(
      { env: c.env, ledger },
      c.req.valid("json"),
    );

    return successResponse(c, { data: expenses });
  } catch (error) {
    if (error instanceof ChatError) return chatErrorResponse(c, error);
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
