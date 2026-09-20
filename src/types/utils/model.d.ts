import type {
  Agent,
  AgentInputItem,
  AgentOptions,
  RunState,
} from "@openai/agents";
import type { TContext } from "@/types/common";
import type { ToolLoopAgentSettings } from "ai";

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

export type TSwitchProvider = Pick<TCreateAgent, "c" | "provider">;
