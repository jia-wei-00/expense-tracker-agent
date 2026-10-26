import { HTTP_STATUS } from "@/constants/error";
import {
  applyApprovals,
  supersedeApprovals,
} from "@/services/ai/chat/approval.service";
import { ChatError } from "@/services/ai/chat/chat.error";
import {
  appendMessage,
  loadMessages,
} from "@/services/ai/chat/message.service";
import {
  ensureSession,
  sessionExists,
} from "@/services/ai/chat/session.service";
import { consumeAiUsage } from "@/services/subscription/usage.service";
import type { TAiChat, TChatMessage, TChatTools } from "@/types/ai";
import type { TSupabaseAdminClient, TSupabaseClient } from "@/types/common";

/**
 * Builds the message list for this turn. Approvals resolve the pending tool
 * calls of the stored history; a new user message consumes one chat unit of
 * the monthly AI quota, then is persisted and appended (cancelling any
 * pending approvals).
 *
 * Sessions and history are read through the user-scoped `supabase` client so
 * RLS enforces ownership; `chat_message` writes go through the service-role
 * `admin` client (users have no insert/update policy), so every write must
 * follow a user-scoped ownership check of the session.
 */
export async function prepareTurn(
  supabase: TSupabaseClient,
  admin: TSupabaseAdminClient,
  userId: string,
  body: TAiChat,
  tools: TChatTools,
): Promise<TChatMessage[]> {
  const { sessionId } = body;

  if ("approvals" in body) {
    if (!(await sessionExists(supabase, sessionId))) {
      throw new ChatError(HTTP_STATUS.NOT_FOUND, "Chat session not found");
    }
    const history = await loadMessages(supabase, sessionId, tools);
    return applyApprovals(admin, sessionId, history, body.approvals);
  }

  const { message } = body;
  const history = await loadMessages(supabase, sessionId, tools);
  // Before any write: a 402/429 must not leave a session or an unanswered
  // message behind. Approval continuations never reach here.
  await consumeAiUsage(admin, userId, "chat");
  await ensureSession(supabase, sessionId, message);
  const resolved = await supersedeApprovals(admin, sessionId, history);
  await appendMessage(admin, sessionId, message);
  return [...resolved, message];
}
