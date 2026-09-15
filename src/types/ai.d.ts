import { promptSchema } from "@/schemas/ai";
import { z } from "zod";

export type TAiPrompt = z.infer<typeof promptSchema>;
