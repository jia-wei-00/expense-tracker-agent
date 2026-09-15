import {
  ModelConfig,
  TCreateAgent,
  TSwitchProvider,
} from "@/types/utils/model";
import {
  Agent,
  OpenAIChatCompletionsModel,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTraceProcessors,
} from "@openai/agents";
import OpenAI from "openai";
import { initLogger } from "braintrust";
import {
  getGeminiConfig,
  getMercuryConfig,
  getNvidiaConfig,
} from "@/constants/model-config";
import { OpenAIAgentsTraceProcessor } from "@braintrust/openai-agents";

export const createAgent = async ({
  model,
  c,
  input,
  provider,
  ...rest
}: TCreateAgent) => {
  const { env, executionCtx } = c;
  const {
    baseURL,
    apiKey,
    model: defaultModel,
  } = switchProvider({ c, provider });
  const logger = initLogger({
    projectName: "spend-tracker-agent",
    apiKey: env.BRAINTRUST_API_KEY,
    noExitFlush: true,
  });

  // NOTE: use the processor from `@braintrust/openai-agents`, not
  // `braintrust/instrumentation`. That subpath has no `workerd` export
  // condition, so it resolves to the Node build, whose internal state is never
  // initialized in a Worker and throws on the first trace event.
  const traceProcessor = new OpenAIAgentsTraceProcessor({ logger });
  setTraceProcessors([traceProcessor]);
  const openAIClient = new OpenAI({ baseURL, apiKey });
  const selectedModel = new OpenAIChatCompletionsModel(
    openAIClient,
    model ?? defaultModel,
  );
  setDefaultOpenAIClient(openAIClient);
  setOpenAIAPI("chat_completions");

  const agent = new Agent({
    ...rest,
    model: selectedModel,
  });

  const result = await run(agent, input, {
    stream: true,
  });

  // With `stream: true`, `run()` resolves before the run is actually executed.
  // Flush Braintrust only once the stream has been fully consumed, otherwise
  // no spans have been produced yet and the logs stay empty.
  executionCtx.waitUntil(result.completed.then(() => logger.flush()));

  return result;
};

const switchProvider = (props: TSwitchProvider): ModelConfig => {
  const {
    c: { env },
    provider,
  } = props;

  switch (provider) {
    case "gemini":
      return getGeminiConfig(env);
    case "mercury":
      return getMercuryConfig(env);
    case "nvidia":
      return getNvidiaConfig(env);
    default:
      return getGeminiConfig(env);
  }
};
