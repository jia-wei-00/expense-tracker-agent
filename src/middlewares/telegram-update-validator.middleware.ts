import { zValidator } from "@hono/zod-validator";
import { successResponse } from "@/libs/response";
import { telegramUpdateSchema, updateIdSchema } from "@/schemas/telegram.schema";

/**
 * Validates a Telegram update. Unlike the shared validator, a body that fails
 * the schema is acked with 200: Telegram redelivers every non-2xx update until
 * it expires, and a malformed update will never become valid.
 */
export const telegramUpdateValidator = zValidator("json", telegramUpdateSchema, (result, c) => {
  if (result.success) return;
  // On failure `data` is the raw body, despite its type.
  const updateId = updateIdSchema.safeParse(result.data).data?.update_id;
  console.warn(JSON.stringify({ log: "telegram_webhook", update_id: updateId, outcome: "invalid" }));
  return successResponse(c, {});
});
