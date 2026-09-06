import { protocol } from "@openai/agents";
import { z } from "zod";

export const promptSchema = z.array(protocol.ModelItem).min(1);
