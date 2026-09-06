import {
  run,
  type Agent,
  type AgentInputItem,
  type StreamRunOptions,
} from "@openai/agents";
import type { TContext } from "@/types/common";
import { wrapOpenAI } from "braintrust";

export const runStreamedAgent = async <
  TAgent extends Agent,
  TAgentContext = undefined,
>(
  c: TContext,
  agent: TAgent,
  input: AgentInputItem[],
  options?: Omit<StreamRunOptions<TAgentContext, TAgent>, "stream">,
) => {
  let streamCompleted: Promise<void> = Promise.resolve();

  const resultStream = wrapOpenAI(
    await run(agent, input, {
      ...options,
      stream: true,
    }),
  );
  streamCompleted = resultStream.completed;

  return resultStream;
};
