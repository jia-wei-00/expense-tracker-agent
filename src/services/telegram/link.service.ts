import { TELEGRAM_COPY } from "@/constants/telegram";
import type { TTelegramDeps, TTelegramMessage } from "@/types/telegram";
import { parseStartToken } from "@/utils/telegram";

// `link_telegram` raises these messages; anything else is unexpected and thrown
// so the inbox retries it.
const LINK_ERROR_COPY: Record<string, string> = {
  token_invalid: TELEGRAM_COPY.linkBadToken,
  telegram_already_linked: TELEGRAM_COPY.linkTaken,
};

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
  const telegramUserId = message.from?.id ?? chatId;
  const { error } = await admin.rpc("link_telegram", {
    p_token: token,
    p_telegram_user_id: telegramUserId,
  });
  const errorCopy = error ? LINK_ERROR_COPY[error.message] : undefined;
  if (error && !errorCopy) {
    throw new Error(`link_telegram failed: ${error.message}`);
  }

  console.log(
    JSON.stringify({ log: "telegram_link", chat_id: chatId, outcome: error ? error.message : "linked" }),
  );
  await telegram.sendMessage({ chatId, text: errorCopy ?? TELEGRAM_COPY.linkOk });
}
