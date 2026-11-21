import type {
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
