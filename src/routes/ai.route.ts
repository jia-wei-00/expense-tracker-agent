import { Hono } from "hono";
import { aiPrompt } from "@/services/ai";
import zValidator from "@/middlewares/zod.validator";
import { promptSchema } from "@/schemas/ai";
import { withSupabase } from "@supabase/server/adapters/hono";

const app = new Hono();

app.use("*", withSupabase({ auth: "user" }));
app.post("/", zValidator("json", promptSchema), aiPrompt);

export default app;
