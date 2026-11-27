import {
  telegramEnvelopeSchema,
  telegramFileSchema,
  telegramSentMessageSchema,
} from "@/schemas/telegram.schema";
import type {
  TFetch,
  TSendMessageInput,
  TTelegramClient,
  TTelegramClientOptions,
} from "@/types/telegram";

const API_BASE = "https://api.telegram.org";
const NOT_MODIFIED = "message is not modified";

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function mediaTypeOf(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

// Thrown messages carry only the method and Telegram's description: the token is
// part of every URL, so the underlying fetch error is never forwarded.
async function callMethod(
  fetch: TFetch,
  token: string,
  method: string,
  payload: object,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`telegram ${method}: request failed`);
  }
  const envelope = telegramEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!envelope.success) {
    throw new Error(`telegram ${method}: unexpected response (HTTP ${response.status})`);
  }
  if (!envelope.data.ok) {
    throw new Error(`telegram ${method}: ${envelope.data.description ?? "unknown error"}`);
  }
  return envelope.data.result;
}

async function downloadBytes(fetch: TFetch, token: string, filePath: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/file/bot${token}/${filePath}`);
  } catch {
    throw new Error("telegram downloadFile: request failed");
  }
  if (!response.ok) {
    throw new Error(`telegram downloadFile: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** An edit that changes nothing (e.g. a retried one) already has the wanted result. */
async function ignoreNotModified(edit: Promise<unknown>): Promise<void> {
  try {
    await edit;
  } catch (error) {
    if (error instanceof Error && error.message.includes(NOT_MODIFIED)) return;
    throw error;
  }
}

function sendMessagePayload({ chatId, text, replyTo, buttons }: TSendMessageInput): object {
  return {
    chat_id: chatId,
    text,
    // Still sent when the user deleted the message it answers; otherwise every
    // retry fails the same way and the reply is lost.
    reply_parameters:
      replyTo === undefined ? undefined : { message_id: replyTo, allow_sending_without_reply: true },
    reply_markup: buttons && {
      inline_keyboard: [buttons.map((button) => ({ text: button.text, callback_data: button.data }))],
    },
  };
}

export function createTelegramClient({
  token,
  fetch = globalThis.fetch,
}: TTelegramClientOptions): TTelegramClient {
  const request = (method: string, payload: object) => callMethod(fetch, token, method, payload);

  return {
    async sendMessage(input) {
      const result = await request("sendMessage", sendMessagePayload(input));
      return { messageId: telegramSentMessageSchema.parse(result).message_id };
    },

    async sendChatAction(chatId) {
      await request("sendChatAction", { chat_id: chatId, action: "typing" });
    },

    async answerCallbackQuery(id, text) {
      await request("answerCallbackQuery", { callback_query_id: id, text });
    },

    async editMessageReplyMarkup(chatId, messageId) {
      await ignoreNotModified(
        request("editMessageReplyMarkup", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
      );
    },

    async editMessageText(chatId, messageId, text) {
      await ignoreNotModified(request("editMessageText", { chat_id: chatId, message_id: messageId, text }));
    },

    async downloadFile(fileId) {
      const file = telegramFileSchema.parse(await request("getFile", { file_id: fileId }));
      const bytes = await downloadBytes(fetch, token, file.file_path);
      return {
        bytes,
        mediaType: mediaTypeOf(file.file_path),
      };
    },
  };
}
