import { TELEGRAM_COPY } from "@/constants/telegram";
import type { TSupabaseAdminClient } from "@/types/common";
import type { TTelegramDeps, TTelegramMessage } from "@/types/telegram";
import { parseStartToken } from "@/utils/telegram";

/** The app user this Telegram account is linked to, if any. */
export async function linkedUserId(
  admin: TSupabaseAdminClient,
  telegramUserId: number,
): Promise<string | undefined> {
  const { data, error } = await admin
    .from("user_profile")
    .select("user_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw new Error(`user_profile lookup failed: ${error.message}`);
  return data?.user_id;
}

/**
 * Calls `link_telegram` and picks the reply. Errors other than the two the RPC
 * raises on purpose are thrown so the inbox retries them.
 */
async function attemptLink(
  admin: TSupabaseAdminClient,
  token: string,
  telegramUserId: number,
): Promise<{ outcome: string; text: string }> {
  const { error } = await admin.rpc("link_telegram", {
    p_token: token,
    p_telegram_user_id: telegramUserId,
  });
  if (!error) return { outcome: "linked", text: TELEGRAM_COPY.linkOk };
  if (error.message === "telegram_already_linked") {
    return { outcome: error.message, text: TELEGRAM_COPY.linkTaken };
  }
  if (error.message !== "token_invalid") {
    throw new Error(`link_telegram failed: ${error.message}`);
  }

  // A used token for an account that is already linked: a retry after the
  // "Linked" reply failed to send, or the same link tapped twice.
  if ((await linkedUserId(admin, telegramUserId)) !== undefined) {
    return { outcome: "already_linked", text: TELEGRAM_COPY.linkOk };
  }
  return { outcome: error.message, text: TELEGRAM_COPY.linkBadToken };
}

/** `/start <token>` in a DM: binds this Telegram account to the app user who issued the token. */
export async function linkTelegram(
  { admin, telegram }: TTelegramDeps,
  message: TTelegramMessage,
): Promise<void> {
  const chatId = message.chat.id;
  const token = parseStartToken(message.text ?? "");
  if (!token) {
    await telegram.sendMessage({ chatId, text: TELEGRAM_COPY.unlinked });
    return;
  }

  // In a private chat the chat id is the user's id; `from` is just the explicit form.
  const { outcome, text } = await attemptLink(admin, token, message.from?.id ?? chatId);
  console.log(JSON.stringify({ log: "telegram_link", chat_id: chatId, outcome }));
  await telegram.sendMessage({ chatId, text });
}
