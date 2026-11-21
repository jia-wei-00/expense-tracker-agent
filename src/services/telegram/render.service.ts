import { TYPING_INTERVAL_MS } from "@/constants/telegram";
import type { TChatMessage } from "@/types/ai";
import type { TTelegramClient } from "@/types/telegram";
import { splitMessage } from "@/utils/telegram";

/** The text of an assistant reply, one paragraph per text part; tool parts are skipped. */
export function replyText(message: TChatMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
    .join("\n\n");
}

/** Sends `text` in Telegram-sized chunks, the first one as a reply to `replyTo`. */
export async function sendReply(
  telegram: TTelegramClient,
  { chatId, replyTo, text }: { chatId: number; replyTo: number; text: string },
): Promise<void> {
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    // Sequential on purpose: Telegram shows the chunks in send order.
    await telegram.sendMessage({ chatId, text: chunk, replyTo: index === 0 ? replyTo : undefined });
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Telegram shows "typing" for about 5 s, so it is resent until `signal` aborts. */
async function keepTyping(telegram: TTelegramClient, chatId: number, signal: AbortSignal) {
  while (!signal.aborted) {
    // Best effort: a failed indicator must never fail the turn.
    await telegram.sendChatAction(chatId).catch((error: unknown) => {
      console.warn("telegram typing failed:", error instanceof Error ? error.message : String(error));
    });
    await sleep(TYPING_INTERVAL_MS, signal);
  }
}

/** Runs `run` while the chat shows "typing", and stops the indicator however it ends. */
export async function withTyping<T>(
  telegram: TTelegramClient,
  chatId: number,
  run: () => Promise<T>,
): Promise<T> {
  const done = new AbortController();
  const typing = keepTyping(telegram, chatId, done.signal);
  try {
    return await run();
  } finally {
    done.abort();
    await typing;
  }
}
