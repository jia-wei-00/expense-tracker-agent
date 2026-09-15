import type { AgentOptions, AgentInputItem, Model } from "@openai/agents";
import type { TContext } from "@/types/common";
import type { TInputType } from "@/types/ai";

export type TProvider = "gemini" | "mercury" | "nvidia";
export type TInputType = string | AgentInputItem[];

export type TCreateAgent = Omit<AgentOptions, "model"> & {
  model?: string;
  input: TInputType;
  provider?: TProvider;
  c: TContext;
};

export type ModelConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type TSwitchProvider = Pick<TCreateAgent, "c" | "provider">;
