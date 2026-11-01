import { Hono } from "hono";
import { cors } from "hono/cors";
import { withSupabase } from "@supabase/server/adapters/hono";
import zValidator from "@/middlewares/zod.validator";
import { chatSchema, scanSchema } from "@/schemas/ai";
import { aiChat, aiScan } from "@/handlers/ai.handler";
import { braintrust } from "@/middlewares/braintrust.middleware";
import type { TAppEnv } from "@/types/common";
import { requirePlan } from "@/middlewares/require-plan.middleware";

export const ai = new Hono<TAppEnv>();

// `withSupabase` does not handle CORS, so the browser client needs Hono's.
ai.use(
  "*",
  cors({
    origin: (origin, c) => c.env.CORS_ORIGIN || origin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);
ai.use("*", withSupabase({ auth: "user" }));
ai.use("*", requirePlan({ plans: ["plus", "pro"] }));
ai.use("*", braintrust);
ai.post("/chat", zValidator("json", chatSchema), aiChat);
ai.post("/scan", zValidator("json", scanSchema), aiScan);
