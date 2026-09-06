import { Hono } from "hono";
import ai from "@/routes/ai.route";

const app = new Hono();

app.route("/ai", ai);

export default app;
