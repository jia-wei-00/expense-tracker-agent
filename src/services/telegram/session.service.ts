import { deriveTitle } from "@/services/ai/chat/session.service";
import type { TChatMessage } from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import type { TTelegramSession, TTelegramSessionScope } from "@/types/telegram";

/**
 * The newest session of this conversation, or `undefined` before the first.
 * Filtered by `user_id` too, not only the Telegram ids: clients may update
 * their own `chat_session` rows, so the Telegram columns alone are not proof
 * of ownership. `lastMessageAt` is the newest message, else the creation time.
 */
export async function currentSession(
  admin: TSupabaseAdminClient,
  { userId, chatId, telegramUserId }: TTelegramSessionScope,
): Promise<TTelegramSession | undefined> {
  const { data, error } = await admin
    .from("chat_session")
    .select("id, created_at, chat_message(created_at)")
    .eq("user_id", userId)
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", telegramUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    // Only the newest message of that session is needed.
    .order("created_at", { referencedTable: "chat_message", ascending: false })
    .limit(1, { referencedTable: "chat_message" })
    .maybeSingle();

  if (error) throw new Error(`chat_session lookup failed: ${error.message}`);
  if (data === null) return undefined;
  const lastMessageAt = data.chat_message[0]?.created_at ?? data.created_at;
  return { id: data.id, lastMessageAt: new Date(lastMessageAt) };
}

/**
 * Starts a session for this conversation, titled from its first message.
 * `user_id` is set explicitly: its default is `auth.uid()`, null for the
 * service role.
 */
export async function startSession(
  admin: TSupabaseAdminClient,
  { userId, chatId, telegramUserId }: TTelegramSessionScope,
  firstMessage?: TChatMessage,
): Promise<string> {
  const { data, error } = await admin
    .from("chat_session")
    .insert({
      user_id: userId,
      telegram_chat_id: chatId,
      telegram_user_id: telegramUserId,
      title: firstMessage ? deriveTitle(firstMessage) : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`chat_session insert failed: ${error.message}`);
  return data.id;
}

/** Titles a session `/new` started empty, once its first message arrives. */
export async function titleSession(
  admin: TSupabaseAdminClient,
  { userId, sessionId, firstMessage }: { userId: string; sessionId: string; firstMessage: TChatMessage },
): Promise<void> {
  const { error } = await admin
    .from("chat_session")
    .update({ title: deriveTitle(firstMessage) })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("title", null);

  if (error) throw new Error(`chat_session title failed: ${error.message}`);
}
