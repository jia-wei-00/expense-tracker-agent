import { Hono } from "hono";
import { ai } from "@/routes/ai.route";
import { webhooks } from "@/routes/webhooks.route";
import type { TAppEnv } from "@/types/common";

const app = new Hono<TAppEnv>();

app.route("/ai", ai);
app.route("/webhooks", webhooks);

export default app;
