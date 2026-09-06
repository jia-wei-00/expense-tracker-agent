import { TCreateAgent } from "@/types/utils/model";
import { Agent, OpenAIChatCompletionsModel } from "@openai/agents";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "@/constants/model-config";
import { wrapOpenAI } from "braintrust";

export const createAgent = ({
  baseURL,
  apiKey,
  model,
  customModel,
  ...rest
}: TCreateAgent) => {
  const selectedModel = customModel
    ? customModel
    : new OpenAIChatCompletionsModel(new OpenAI({ baseURL, apiKey }), model);

  const agent = new Agent({
    ...rest,
    name: rest.name ?? "Assistant",
    instructions: rest.instructions,
    model: selectedModel,
  });

  return wrapOpenAI(agent);
};
