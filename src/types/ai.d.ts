import { promptSchema } from "@/schemas/ai";
import { TContext } from "@/types/common";
import type { AppBindings } from "@/types/common";
import { AgentOptions } from "@openai/agents";
import { z } from "zod";

export type TAiPrompt = z.infer<typeof promptSchema>;

export interface ICreateModelAgent extends Omit<
  AgentOptions,
  "model" | "name"
> {
  env: AppBindings;
  name?: string;
}
