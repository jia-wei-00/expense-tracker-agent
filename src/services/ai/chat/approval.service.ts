import {
  PENDING_TTL_MS,
  REJECTED_REASON,
  SUPERSEDED_REASON,
} from "@/constants/ai";
import { HTTP_STATUS } from "@/constants/error";
import { ChatError } from "@/services/ai/chat/chat.error";
import type {
  TApproval,
  TChatMessage,
  TChatMessagePart,
  TPendingToolPart,
  TToolPart,
} from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import { toJson } from "@/utils/json";
import { isToolUIPart } from "ai";

function isPending(part: TChatMessagePart): part is TPendingToolPart {
  return isToolUIPart(part) && part.state === "approval-requested";
}

function pendingApprovals(message: TChatMessage | undefined) {
  return message?.role === "assistant" ? message.parts.filter(isPending) : [];
}

/**
 * Rewrites the pending tool parts of the stored message, but only if they are
 * still pending: the conditional update makes each approval single-use even
 * under concurrent requests. Returns `null` when another request got there first.
 */
async function resolvePending(
  admin: TSupabaseAdminClient,
  sessionId: string,
  message: TChatMessage,
  resolve: (part: TPendingToolPart) => TToolPart,
): Promise<TChatMessage | null> {
  const pending = pendingApprovals(message);
  const updated: TChatMessage = {
    ...message,
    parts: message.parts.map((part) =>
      isPending(part) ? resolve(part) : part,
    ),
  };

  const { data, error } = await admin
    .from("chat_message")
    .update({ data: toJson(updated) })
    .eq("session_id", sessionId)
    .eq("ui_id", message.id)
    .contains("data", {
      parts: pending.map(({ toolCallId }) => ({
        toolCallId,
        state: "approval-requested",
      })),
    })
    .select("id");

  if (error) throw new Error(error.message);
  return data.length > 0 ? updated : null;
}

/** Every approval targets a pending call, and every pending call is answered. */
function assertDecisions(
  pending: TPendingToolPart[],
  approvals: TApproval[],
  decisions: Map<string, boolean>,
) {
  const isPendingCall = (callId: string) =>
    pending.some(({ toolCallId }) => toolCallId === callId);

  if (approvals.some(({ callId }) => !isPendingCall(callId))) {
    throw new ChatError(
      HTTP_STATUS.CONFLICT,
      "Unknown or already answered tool call",
    );
  }
  if (pending.some(({ toolCallId }) => !decisions.has(toolCallId))) {
    throw new ChatError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      "Every pending tool call needs a decision",
      `Pending: ${pending.map(({ toolCallId }) => toolCallId).join(", ")}`,
    );
  }
}

/**
 * Applies the user's approve/reject decisions to the pending tool calls of the
 * last assistant message. Tool inputs come from the stored message; the client
 * only supplies call ids and booleans. Every pending call must be answered.
 */
export async function applyApprovals(
  admin: TSupabaseAdminClient,
  sessionId: string,
  messages: TChatMessage[],
  approvals: TApproval[],
): Promise<TChatMessage[]> {
  const last = messages.at(-1);
  const pending = pendingApprovals(last);
  const decisions = new Map(
    approvals.map(({ callId, approve }) => [callId, approve]),
  );

  if (!last || pending.length === 0) {
    throw new ChatError(HTTP_STATUS.CONFLICT, "No pending approval");
  }
  assertDecisions(pending, approvals, decisions);

  const savedAt = Date.parse(last.metadata?.savedAt ?? "");
  if (!Number.isNaN(savedAt) && Date.now() - savedAt > PENDING_TTL_MS) {
    throw new ChatError(HTTP_STATUS.GONE, "Approval expired");
  }

  // Every pending call has a decision (checked above); a miss would deny.
  const updated = await resolvePending(admin, sessionId, last, (part) => {
    const approved = decisions.get(part.toolCallId) === true;
    return {
      ...part,
      state: "approval-responded",
      approval: {
        ...part.approval,
        approved,
        reason: approved ? undefined : REJECTED_REASON,
      },
    };
  });

  if (!updated) {
    throw new ChatError(HTTP_STATUS.CONFLICT, "Approval already answered");
  }
  return [...messages.slice(0, -1), updated];
}

/**
 * A new user message while approvals are pending cancels them, so the history
 * stays valid (every tool call has a result) and the stale action can't run.
 */
export async function supersedeApprovals(
  admin: TSupabaseAdminClient,
  sessionId: string,
  messages: TChatMessage[],
): Promise<TChatMessage[]> {
  const last = messages.at(-1);
  if (!last || pendingApprovals(last).length === 0) return messages;

  const updated = await resolvePending(admin, sessionId, last, (part) => ({
    ...part,
    state: "output-denied",
    approval: {
      ...part.approval,
      approved: false,
      reason: SUPERSEDED_REASON,
    },
  }));

  if (!updated) {
    // A concurrent approval claimed these calls; its run is still writing.
    throw new ChatError(HTTP_STATUS.CONFLICT, "Approval in progress, retry");
  }
  return [...messages.slice(0, -1), updated];
}
