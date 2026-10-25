import { CHAT_HISTORY_LIMIT, MESSAGE_TYPE_BY_ROLE } from "@/constants/ai";
import { HTTP_STATUS, PG_ERROR_CODE } from "@/constants/error";
import { chatMetadataSchema } from "@/schemas/ai";
import { ChatError } from "@/services/ai/chat/chat.error";
import type { TChatMessage, TChatTools } from "@/types/ai";
import type { TSupabaseAdminClient, TSupabaseClient } from "@/types/common";
import { toJson } from "@/utils/json";
import { validateUIMessages } from "ai";

/**
 * The most recent `CHAT_HISTORY_LIMIT` messages, oldest first. `data` is an
 * untyped `jsonb` column, so rows are validated (message shape, metadata, tool
 * inputs/outputs against `tools`) before they are used as `TChatMessage`.
 */
export async function loadMessages(
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

/** The `chat_message` row for `message`, stamped with `metadata.savedAt`. */
function toRow(sessionId: string, message: TChatMessage) {
  return {
    session_id: sessionId,
    type: MESSAGE_TYPE_BY_ROLE[message.role],
    data: toJson({
      ...message,
      metadata: { ...message.metadata, savedAt: new Date().toISOString() },
    }),
  };
}

/** Inserts a new user message; a reused message id is a 409. */
export async function appendMessage(
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
