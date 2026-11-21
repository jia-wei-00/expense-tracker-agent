import { z } from "zod";

const chatSchema = z.looseObject({ id: z.number(), type: z.string() });

const userSchema = z.looseObject({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  username: z.string().optional(),
});

export const telegramPhotoSizeSchema = z.looseObject({
  file_id: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number().optional(),
});

export const telegramMessageSchema = z.looseObject({
  message_id: z.number(),
  chat: chatSchema,
  from: userSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(telegramPhotoSizeSchema).optional(),
  document: z
    .looseObject({
      file_id: z.string(),
      mime_type: z.string().optional(),
      file_size: z.number().optional(),
    })
    .optional(),
  voice: z.unknown().optional(),
  video: z.unknown().optional(),
  sticker: z.unknown().optional(),
});

export const telegramCallbackQuerySchema = z.looseObject({
  id: z.string(),
  from: userSchema,
  data: z.string().optional(),
  message: z.looseObject({ message_id: z.number(), chat: chatSchema }).optional(),
});

export const telegramUpdateSchema = z.looseObject({
  update_id: z.number(),
  message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackQuerySchema.optional(),
  my_chat_member: z
    .looseObject({
      chat: chatSchema,
      new_chat_member: z.looseObject({ status: z.string() }),
    })
    .optional(),
});

export const updateKindSchema = z.enum(["start", "help", "new", "message", "callback", "ignore"]);
