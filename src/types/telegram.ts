import type {
  inboxRowSchema,
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
import type { TChatMessage } from "@/types/ai";
import type { TAppBindings, TSupabaseAdminClient } from "@/types/common";

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
export type TTelegramDeps = {
  env: TAppBindings;
  admin: TSupabaseAdminClient;
  telegram: TTelegramClient;
};
export type TInboxRow = z.infer<typeof inboxRowSchema>;
/** What the inbox alarm does with its oldest row once `attempts` is incremented. */
export type TInboxStep = "process" | "drop";
/** Whose Telegram conversation: the linked app user, the chat and the sender. */
export type TTelegramSessionScope = {
  userId: string;
  chatId: number;
  telegramUserId: number;
};
/** The newest session of a scope, with when it was last written to. */
export type TTelegramSession = { id: string; lastMessageAt: Date };
/** Where a Telegram message stands in the stored history (see `turnResumeState`). */
export type TTurnResumeState = "new" | "resume" | "duplicate";
/** What a DM message leads to once its session and history are known. */
export type TDmTurn =
  | { kind: "run"; sessionId: string; messages: TChatMessage[] }
  | { kind: "refuse"; copy: string }
  | { kind: "resend"; reply: TChatMessage }
  | { kind: "skip" };
