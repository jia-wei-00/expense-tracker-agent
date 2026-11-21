import { TELEGRAM_COPY } from "@/constants/telegram";
import { linkTelegram } from "@/services/telegram/link.service";
import type { TTelegramDeps, TTelegramUpdate } from "@/types/telegram";
import { chatIdOf, classifyUpdate } from "@/utils/telegram";

/**
 * Routes one update from a chat's inbox. A throw leaves the update in the inbox
 * to be retried, so everything here must be safe to run again.
 */
export async function handleUpdate(deps: TTelegramDeps, update: TTelegramUpdate): Promise<void> {
  const chatId = chatIdOf(update);
  if (chatId === undefined) return;
  const reply = (text: string) => deps.telegram.sendMessage({ chatId, text });

  const kind = classifyUpdate(update);
  switch (kind) {
    case "start":
      // "start" is only ever classified from a message.
      if (update.message) await linkTelegram(deps, update.message);
      return;
    case "help":
      await reply(TELEGRAM_COPY.help);
      return;
    case "message":
    case "new":
    case "callback":
      await reply(TELEGRAM_COPY.comingSoon);
      return;
    case "ignore":
      return;
  }
  kind satisfies never;
}
