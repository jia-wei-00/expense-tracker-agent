import type {
  Agent,
  AgentInputItem,
  AgentOptions,
  RunState,
} from "@openai/agents";
import type { AppBindings, TContext } from "@/types/common";
import type { ToolLoopAgentSettings, wrapLanguageModel } from "ai";

export type TProvider = "gemini" | "mercury" | "nvidia" | "groq";
export type TInputType = string | AgentInputItem[];

export type TBuildAgent = Omit<AgentOptions, "model"> & {
  provider?: TProvider;
  c: TContext;
};

export type TCreateAgent = TBuildAgent &
  ToolLoopAgentSettings & {
    input: TInputType;
  };

export type TRunAgent = {
  c: TContext;
  agent: Agent;
  input: TInputType;
};

export type TResumeAgent = {
  c: TContext;
  agent: Agent;
  state: RunState<any, any>;
};

export type TSwitchProvider = Pick<TCreateAgent, "c" | "provider"> & {
  /** Provider retried when `provider` fails. Ignored without `provider`. */
  fallback?: TProvider;
};

/** An AI SDK (spec v4) language model, which every provider here returns. */
export type TLanguageModel = ReturnType<typeof wrapLanguageModel>;

export type TBuildModel = {
  provider: TProvider;
  env: AppBindings;
};

export type TBuildOpenAICompatible = {
  name: "mercury" | "nvidia";
  env: AppBindings;
};

export type TWithFallback = {
  model: TLanguageModel;
  fallback: TLanguageModel;
  from: TProvider;
  to: TProvider;
};
