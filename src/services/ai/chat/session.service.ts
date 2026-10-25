import { TITLE_MAX_LENGTH } from "@/constants/ai";
import { HTTP_STATUS, PG_ERROR_CODE } from "@/constants/error";
import { ChatError } from "@/services/ai/chat/chat.error";
import type { TChatMessage } from "@/types/ai";
import type { TSupabaseClient } from "@/types/common";

/** Whether `sessionId` exists and belongs to the user (RLS hides others). */
export async function sessionExists(
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
export async function ensureSession(
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
