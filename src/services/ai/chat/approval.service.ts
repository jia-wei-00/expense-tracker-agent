import {
  PENDING_TTL_MS,
  REJECTED_REASON,
  SUPERSEDED_REASON,
  UNEXECUTED_REASON,
} from "@/constants/ai";
import { HTTP_STATUS } from "@/constants/error";
import { ChatError } from "@/services/ai/chat/chat.error";
import type {
  TApproval,
  TApprovedToolPart,
  TChatMessage,
  TChatMessagePart,
  TPendingToolPart,
  TToolCallState,
} from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import { toJson } from "@/utils/json";
import { isToolUIPart } from "ai";

function isPending(part: TChatMessagePart): part is TPendingToolPart {
  return isToolUIPart(part) && part.state === "approval-requested";
}

function isApprovedUnexecuted(part: TChatMessagePart): part is TApprovedToolPart {
  return (
    isToolUIPart(part) &&
    part.state === "approval-responded" &&
    part.approval.approved
  );
}

/** The tool calls of `message` still waiting for a decision; none unless it is an assistant message. */
export function pendingApprovals(message: TChatMessage | undefined) {
  return message?.role === "assistant" ? message.parts.filter(isPending) : [];
}

/**
 * The calls of `message` approved but never run: the run that executes them
 * failed (or, in the app, is still streaming). None unless it is an assistant message.
 */
export function unexecutedApprovals(message: TChatMessage | undefined) {
  return message?.role === "assistant"
    ? message.parts.filter(isApprovedUnexecuted)
    : [];
}

function callStates(parts: TToolCallState[]): TToolCallState[] {
  return parts.map(({ toolCallId, state }) => ({ toolCallId, state }));
}

/**
 * Stores `updated` over the message with the same id, but only if every call
 * in `expected` is still in that state: the conditional update makes each
 * decision single-use even under concurrent requests. Returns `false` when
 * another request got there first.
 */
async function updateIfUnchanged(
  admin: TSupabaseAdminClient,
  sessionId: string,
  updated: TChatMessage,
  expected: TToolCallState[],
): Promise<boolean> {
  const { data, error } = await admin
    .from("chat_message")
    .update({ data: toJson(updated) })
    .eq("session_id", sessionId)
    .eq("ui_id", updated.id)
    .contains("data", { parts: expected })
    .select("id");

  if (error) throw new Error(error.message);
  return data.length > 0;
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
 * `message` with each pending call decided. A rejection is stored as
 * `output-denied` right away: the SDK then renders it the same way during this
 * run as on every replay from `chat_message` (an `approval-responded` denial
 * renders differently once reloaded, which invalidates Anthropic's thinking
 * blocks that follow it). A call without a decision is denied.
 */
function decided(
  message: TChatMessage,
  decisions: Map<string, boolean>,
): TChatMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isPending(part)) return part;
      return decisions.get(part.toolCallId) === true
        ? {
            ...part,
            state: "approval-responded",
            approval: { ...part.approval, approved: true },
          }
        : {
            ...part,
            state: "output-denied",
            approval: {
              ...part.approval,
              approved: false,
              reason: REJECTED_REASON,
            },
          };
    }),
  };
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

  const updated = decided(last, decisions);
  if (!(await updateIfUnchanged(admin, sessionId, updated, callStates(pending)))) {
    throw new ChatError(HTTP_STATUS.CONFLICT, "Approval already answered");
  }
  return [...messages.slice(0, -1), updated];
}

/**
 * `message` with every open call closed as `output-denied`: pending ones (the
 * user moved on instead of answering) and approved ones that never ran (their
 * run failed). Either would leave a tool call without a result, which the
 * model provider rejects on every later turn.
 */
export function supersededMessage(message: TChatMessage): TChatMessage {
  return {
    ...message,
    parts: message.parts.map((part) =>
      isPending(part) || isApprovedUnexecuted(part)
        ? {
            ...part,
            state: "output-denied",
            approval: {
              ...part.approval,
              approved: false,
              reason: isPending(part) ? SUPERSEDED_REASON : UNEXECUTED_REASON,
            },
          }
        : part,
    ),
  };
}

/**
 * A new user message (or leaving the session) closes the open calls of the
 * last message, so the history stays valid (every tool call has a result) and
 * a stale action can't run. Single-use: the update only applies while the
 * calls are still in the state they were read in.
 *
 * An approved call without output is settled too: the SDK only executes
 * approvals when they are the last thing in the history, so it would never
 * run once a user message follows; left open it is a tool call with no
 * result. In the app its continuation may in theory still be streaming; its
 * `onEnd` save then overwrites this with the real outcome.
 */
export async function supersedeApprovals(
  admin: TSupabaseAdminClient,
  sessionId: string,
  messages: TChatMessage[],
): Promise<TChatMessage[]> {
  const last = messages.at(-1);
  const open = [...pendingApprovals(last), ...unexecutedApprovals(last)];
  if (!last || open.length === 0) return messages;

  const updated = supersededMessage(last);
  if (!(await updateIfUnchanged(admin, sessionId, updated, callStates(open)))) {
    // A concurrent request decided these calls; its run is still writing.
    throw new ChatError(HTTP_STATUS.CONFLICT, "Approval in progress, retry");
  }
  return [...messages.slice(0, -1), updated];
}
