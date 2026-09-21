import {
  getGeminiConfig,
  getGroqConfig,
  getMercuryConfig,
  getNvidiaConfig,
} from "@/constants/model-config";
import { AppBindings } from "@/types/common";
import { TSwitchProvider } from "@/types/utils/model";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const getModel = (props: TSwitchProvider) => {
  const {
    c: { env },
    provider,
  } = props;

  switch (provider) {
    case "mercury":
      return buildOpenAICompatible({ name: "mercury", env });
    case "nvidia":
      return buildOpenAICompatible({ name: "nvidia", env });
    case "groq":
      const { apiKey: groqKey, model: groqModel } = getGroqConfig(env);
      return createGroq({ apiKey: groqKey })(groqModel);
    case "gemini":
    default:
      const { apiKey, model } = getGeminiConfig(env);
      return createGoogle({ apiKey })(model);
  }
};

const buildOpenAICompatible = ({
  name,
  env,
}: {
  name: "mercury" | "nvidia";
  env: AppBindings;
}) => {
  const { apiKey, baseURL, model } =
    name === "mercury" ? getMercuryConfig(env) : getNvidiaConfig(env);
  return createOpenAICompatible({
    name,
    baseURL,
    headers: { Authorization: `Bearer ${apiKey}` },
  }).chatModel(model);
};
