import { Hono } from "hono";
import { agentPrompt } from "@/agent";
import zValidator from "@/middlewares/validators/zod.validator";
import { promptSchema } from "@/schemas/agent";

const app = new Hono();

app.post("/", zValidator("json", promptSchema), agentPrompt);

export default app;
