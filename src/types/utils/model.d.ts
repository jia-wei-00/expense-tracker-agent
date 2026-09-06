import { AgentOptions, Model } from "@openai/agents";

type ModelConfig =
  | {
      customModel: Model;
      model?: string;
    }
  | {
      customModel?: undefined;
      model: string;
    };

export type TCreateAgent = Omit<AgentOptions, "model"> & {
  baseURL?: string;
  apiKey?: string;
} & ModelConfig;
