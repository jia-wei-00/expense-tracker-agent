import { createMiddleware } from "hono/factory";
import { HTTP_STATUS } from "@/constants/error";
import { errorResponse } from "@/libs/response";
import type { TAppEnv } from "@/types/common";
import { timingSafeEqualText } from "@/utils/crypto";

/**
 * RevenueCat sends the exact `Authorization` value configured in its dashboard
 * on every webhook. `REVENUECAT_WEBHOOK_AUTH` holds that full header value.
 * Runs before the body is parsed; an unset secret rejects everything.
 */
export const revenuecatAuth = createMiddleware<TAppEnv>(async (c, next) => {
  const expected = c.env.REVENUECAT_WEBHOOK_AUTH;
  const received = c.req.header("Authorization") ?? "";

  if (!expected || !timingSafeEqualText(received, expected)) {
    return errorResponse(c, {
      status: HTTP_STATUS.UNAUTHORIZED,
      title: "Unauthorized",
    });
  }
  await next();
});
