import { createMiddleware } from "hono/factory";
import { HTTP_STATUS } from "@/constants/error";
import { errorResponse } from "@/libs/response";
import type { TAppEnv } from "@/types/common";
import { timingSafeEqualText } from "@/utils/crypto";
import { isTelegramIp } from "@/utils/telegram";

/**
 * Telegram webhook auth: the request must come from Telegram's IP ranges and
 * carry the `secret_token` given to `setWebhook`. `TELEGRAM_SKIP_IP_CHECK=true`
 * (local `.dev.vars` only) skips the IP check for tunnels. Runs before the body
 * is parsed; an unset secret rejects everything.
 */
export const telegramAuth = createMiddleware<TAppEnv>(async (c, next) => {
  const skipIpCheck = c.env.TELEGRAM_SKIP_IP_CHECK === "true";
  const fromTelegram = skipIpCheck || isTelegramIp(c.req.header("cf-connecting-ip") ?? "");
  const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
  const received = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";

  if (!fromTelegram || !expected || !timingSafeEqualText(received, expected)) {
    return errorResponse(c, {
      status: HTTP_STATUS.UNAUTHORIZED,
      title: "Unauthorized",
    });
  }
  await next();
});
