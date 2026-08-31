import { Hono } from "hono";
import agent from "@/routes/agent.route";

const app = new Hono();

app.route("/agent", agent);

export default app;
