import { promptSchema } from "@/schemas/agent";
import { z } from "zod";

export type TAgentPrompt = z.infer<typeof promptSchema>;
