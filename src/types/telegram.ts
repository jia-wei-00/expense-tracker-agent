import type {
  telegramEnvelopeSchema,
  telegramFileSchema,
  telegramSentMessageSchema,
  telegramCallbackQuerySchema,
  telegramMessageSchema,
  telegramPhotoSizeSchema,
  telegramUpdateSchema,
  updateKindSchema,
} from "@/schemas/telegram.schema";
import type { z } from "zod";

export type TTelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TTelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TTelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;
export type TTelegramPhotoSize = z.infer<typeof telegramPhotoSizeSchema>;
export type TUpdateKind = z.infer<typeof updateKindSchema>;
export type TCallbackData = { approve: boolean; messageId: number };
export type TTelegramEnvelope = z.infer<typeof telegramEnvelopeSchema>;
export type TTelegramSentMessage = z.infer<typeof telegramSentMessageSchema>;
export type TTelegramFile = z.infer<typeof telegramFileSchema>;
export type TTelegramButton = { text: string; data: string };
export type TFetch = typeof globalThis.fetch;
export type TTelegramClientOptions = { token: string; fetch?: TFetch };
export type TSendMessageInput = {
  chatId: number;
  text: string;
  replyTo?: number;
  buttons?: TTelegramButton[];
};
export type TTelegramClient = {
  sendMessage: (input: TSendMessageInput) => Promise<{ messageId: number }>;
  sendChatAction: (chatId: number) => Promise<void>;
  answerCallbackQuery: (id: string, text?: string) => Promise<void>;
  editMessageReplyMarkup: (chatId: number, messageId: number) => Promise<void>;
  editMessageText: (chatId: number, messageId: number, text: string) => Promise<void>;
  downloadFile: (fileId: string) => Promise<{ bytes: Uint8Array; mediaType: string }>;
};
export type TFakeFetchCall = { url: string; body: unknown };
