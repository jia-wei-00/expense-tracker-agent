import {
  CHAT_HISTORY_LIMIT,
  MESSAGE_TYPE_BY_ROLE,
  PENDING_TTL_MS,
  TITLE_MAX_LENGTH,
} from "@/constants/ai";
import { HTTP_STATUS, PG_ERROR_CODE } from "@/constants/error";
import { chatMetadataSchema } from "@/schemas/ai";
import type { TAiChat, TApproval, TChatMessage, TChatTools } from "@/types/ai";
import type { TSupabaseAdminClient, TSupabaseClient } from "@/types/common";
import { toJson } from "@/utils/json";
import { isToolUIPart, validateUIMessages } from "ai";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Chat persistence. Sessions and history are read through the user-scoped
 * client so RLS enforces ownership; `chat_message` writes go through the
 * service-role client (users have no insert/update policy), so every write
 * must follow a user-scoped ownership check of the session.
 */

/** A request-level failure that maps to a problem+json response. */
export class ChatError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
  }
}

type TPart = TChatMessage["parts"][number];
type TToolPart = Extract<TPart, { toolCallId: string }>;
type TPendingToolPart = Extract<TToolPart, { state: "approval-requested" }>;

const REJECTED_REASON = "The user rejected this action. Nothing was saved.";

const isPending = (part: TPart): part is TPendingToolPart =>
  isToolUIPart(part) && part.state === "approval-requested";

/**
 * Builds the message list for this turn. Approvals resolve the pending tool
 * calls of the stored history; a new user message is persisted and appended
 * (cancelling any pending approvals). Ownership is checked before any write.
 */
export async function prepareTurn(
  supabase: TSupabaseClient,
  admin: TSupabaseAdminClient,
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
  await ensureSession(supabase, sessionId, message);
  const history = await supersedeApprovals(
    admin,
    sessionId,
    await loadMessages(supabase, sessionId, tools),
  );
  await appendMessage(admin, sessionId, message);
  return [...history, message];
}

/** Whether `sessionId` exists and belongs to the user (RLS hides others). */
async function sessionExists(
  supabase: TSupabaseClient,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("chat_session")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data !== null;
}

/**
 * Returns once `sessionId` is a session owned by the user, creating it (titled
 * from `firstMessage`) on first use. The id is client-generated, so a collision
 * with another user's session surfaces as 404.
 */
async function ensureSession(
  supabase: TSupabaseClient,
  sessionId: string,
  firstMessage: TChatMessage,
) {
  if (await sessionExists(supabase, sessionId)) return;

  const { error } = await supabase
    .from("chat_session")
    .insert({ id: sessionId, title: deriveTitle(firstMessage) });

  if (error?.code === PG_ERROR_CODE.UNIQUE_VIOLATION) {
    throw new ChatError(HTTP_STATUS.NOT_FOUND, "Chat session not found");
  }
  if (error) throw new Error(error.message);
}

/**
 * The most recent `CHAT_HISTORY_LIMIT` messages, oldest first. `data` is an
 * untyped `jsonb` column, so rows are validated (message shape, metadata, tool
 * inputs/outputs against `tools`) before they are used as `TChatMessage`.
 */
async function loadMessages(
  supabase: TSupabaseClient,
  sessionId: string,
  tools: TChatTools,
): Promise<TChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_message")
    .select("data")
    .eq("session_id", sessionId)
    .order("id", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);

  if (error) throw new Error(error.message);
  // `validateUIMessages` rejects an empty list (a new session has no history).
  if (data.length === 0) return [];
  return validateUIMessages<TChatMessage>({
    messages: data.reverse().map((row) => row.data),
    metadataSchema: chatMetadataSchema,
    tools,
  });
}

const toRow = (sessionId: string, message: TChatMessage) => ({
  session_id: sessionId,
  type: MESSAGE_TYPE_BY_ROLE[message.role],
  data: toJson({
    ...message,
    metadata: { ...message.metadata, savedAt: new Date().toISOString() },
  }),
});

/** Inserts a new user message; a reused message id is a 409. */
async function appendMessage(
  admin: TSupabaseAdminClient,
  sessionId: string,
  message: TChatMessage,
) {
  const { error } = await admin
    .from("chat_message")
    .insert(toRow(sessionId, message));

  if (error?.code === PG_ERROR_CODE.UNIQUE_VIOLATION) {
    throw new ChatError(HTTP_STATUS.CONFLICT, "Message already exists");
  }
  if (error) throw new Error(error.message);
}

/** Inserts or replaces a message by id (assistant replies and continuations). */
export async function saveMessage(
  admin: TSupabaseAdminClient,
  sessionId: string,
  message: TChatMessage,
) {
  const { error } = await admin
    .from("chat_message")
    .upsert(toRow(sessionId, message), { onConflict: "session_id,ui_id" });

  if (error) throw new Error(error.message);
}

const pendingApprovals = (message: TChatMessage | undefined) =>
  message?.role === "assistant" ? message.parts.filter(isPending) : [];

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
    parts: message.parts.map((part) => (isPending(part) ? resolve(part) : part)),
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

/**
 * Applies the user's approve/reject decisions to the pending tool calls of the
 * last assistant message. Tool inputs come from the stored message; the client
 * only supplies call ids and booleans. Every pending call must be answered.
 */
async function applyApprovals(
  admin: TSupabaseAdminClient,
  sessionId: string,
  messages: TChatMessage[],
  approvals: TApproval[],
): Promise<TChatMessage[]> {
  const last = messages.at(-1);
  const pending = pendingApprovals(last);
  const decisions = new Map(approvals.map((a) => [a.callId, a.approve]));

  if (!last || pending.length === 0) {
    throw new ChatError(HTTP_STATUS.CONFLICT, "No pending approval");
  }
  if (
    approvals.some(
      ({ callId }) => !pending.some((p) => p.toolCallId === callId),
    )
  ) {
    throw new ChatError(
      HTTP_STATUS.CONFLICT,
      "Unknown or already answered tool call",
    );
  }
  if (pending.some(({ toolCallId }) => !decisions.has(toolCallId))) {
    throw new ChatError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      "Every pending tool call needs a decision",
      `Pending: ${pending.map((p) => p.toolCallId).join(", ")}`,
    );
  }

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
        // Without a reason some models read the denied result as success.
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
async function supersedeApprovals(
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
      reason: "The user sent a new message instead of answering.",
    },
  }));

  if (!updated) {
    // A concurrent approval claimed these calls; its run is still writing.
    throw new ChatError(HTTP_STATUS.CONFLICT, "Approval in progress, retry");
  }
  return [...messages.slice(0, -1), updated];
}

/** Session title from the first text part, trimmed to `TITLE_MAX_LENGTH`. */
function deriveTitle(message: TChatMessage) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  return text.length > TITLE_MAX_LENGTH
    ? `${text.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : text;
}
