import { Hono } from "hono";
import { cors } from "hono/cors";
import { withSupabase } from "@supabase/server/adapters/hono";
import { SESSION_HEADER } from "@/constants/ai";
import zValidator from "@/middlewares/zod.validator";
import { approvalSchema, pendingQuerySchema, promptSchema } from "@/schemas/ai";
import { aiPrompt } from "@/services/ai";

const app = new Hono();

// `withSupabase` does not handle CORS, so the browser client needs Hono's.
app.use(
  "*",
  cors({
    origin: (origin, c) => c.env.CORS_ORIGIN || origin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: [SESSION_HEADER],
  }),
);
app.use("*", withSupabase({ auth: "user" }));
app.post("/", zValidator("json", promptSchema), aiPrompt);

export default app;
