import { Hono } from "hono";
import { withSupabase } from "@supabase/server/adapters/hono";
import { revenuecatWebhook } from "@/handlers/webhook.handler";
import { revenuecatAuth } from "@/middlewares/revenuecat-auth.middleware";
import zValidator from "@/middlewares/zod.validator";
import { revenuecatWebhookSchema } from "@/schemas/revenuecat.schema";
import type { TAppEnv } from "@/types/common";

export const webhooks = new Hono<TAppEnv>();

// Server-to-server: no user JWT and no CORS. `auth: "none"` still provides the
// service-role client the subscription RPCs need.
webhooks.use("*", withSupabase({ auth: "none" }));
webhooks.post(
  "/revenuecat",
  revenuecatAuth,
  zValidator("json", revenuecatWebhookSchema),
  revenuecatWebhook,
);
