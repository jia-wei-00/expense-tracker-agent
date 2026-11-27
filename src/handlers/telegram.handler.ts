import { successResponse } from "@/libs/response";
import type { TValidContext } from "@/types/common";
import type { TTelegramUpdate } from "@/types/telegram";
import { chatIdOf, classifyUpdate } from "@/utils/telegram";

/**
 * `POST /webhooks/telegram`. Hands the update to its chat's inbox Durable
 * Object, which stores it and processes it in order, then acks. Updates the bot
 * never acts on are acked without being stored. Only a failed enqueue returns
 * non-2xx, so Telegram redelivers it.
 */
export async function telegramWebhook(c: TValidContext<TTelegramUpdate>) {
  const update = c.req.valid("json");
  const chatId = chatIdOf(update);
  const kind = classifyUpdate(update);

  if (chatId === undefined || kind === "ignore") {
    console.log(
      JSON.stringify({ log: "telegram_webhook", update_id: update.update_id, chat_id: chatId, kind, outcome: "ignored" }),
    );
    return successResponse(c, {});
  }

  await c.env.TELEGRAM_INBOX.getByName(String(chatId)).enqueue(update);
  return successResponse(c, {});
}
