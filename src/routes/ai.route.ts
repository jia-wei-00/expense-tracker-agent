import { Hono } from "hono";
import { cors } from "hono/cors";
import { withSupabase } from "@supabase/server/adapters/hono";
import zValidator from "@/middlewares/zod.validator";
import { chatSchema, scanSchema } from "@/schemas/ai";
import { aiChat, aiScan } from "@/services/ai";
import { braintrust } from "@/middlewares/braintrust.middleware";
import type { TAppEnv } from "@/types/common";

const app = new Hono<TAppEnv>();

// `withSupabase` does not handle CORS, so the browser client needs Hono's.
app.use(
  "*",
  cors({
    origin: (origin, c) => c.env.CORS_ORIGIN || origin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use("*", withSupabase({ auth: "user" }));
app.use("*", braintrust);
app.post("/chat", zValidator("json", chatSchema), aiChat);
app.post("/scan", zValidator("json", scanSchema), aiScan);

export default app;
