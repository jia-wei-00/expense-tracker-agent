import { Hono } from "hono";
import { withSupabase } from "@supabase/server/adapters/hono";
import { telegramWebhook } from "@/handlers/telegram.handler";
import { revenuecatWebhook } from "@/handlers/webhook.handler";
import { revenuecatAuth } from "@/middlewares/revenuecat-auth.middleware";
import { telegramAuth } from "@/middlewares/telegram-auth.middleware";
import { telegramUpdateValidator } from "@/middlewares/telegram-update-validator.middleware";
import zValidator from "@/middlewares/zod.validator";
import { revenuecatWebhookSchema } from "@/schemas/revenuecat.schema";
import type { TAppEnv } from "@/types/common";

export const webhooks = new Hono<TAppEnv>();

// Server-to-server: no user JWT and no CORS. Each provider's secret is checked
// before anything else.

// RevenueCat: `auth: "none"` still provides the service-role client the
// subscription RPCs need.
webhooks.use("/revenuecat", revenuecatAuth);
webhooks.use("/revenuecat", withSupabase({ auth: "none" }));
webhooks.post("/revenuecat", zValidator("json", revenuecatWebhookSchema), revenuecatWebhook);

// Telegram: the update is only stored here; its chat's inbox Durable Object
// does the work (and builds its own Supabase client).
webhooks.post("/telegram", telegramAuth, telegramUpdateValidator, telegramWebhook);
