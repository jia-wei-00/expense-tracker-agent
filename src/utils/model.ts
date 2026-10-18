import {
  getGeminiConfig,
  getGroqConfig,
  getMercuryConfig,
  getNvidiaConfig,
} from "@/constants/model-config";
import {
  TBuildModel,
  TBuildOpenAICompatible,
  TLanguageModel,
  TProvider,
  TSwitchProvider,
  TWithFallback,
} from "@/types/utils/model";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";

const PROVIDERS = [
  "gemini",
  "mercury",
  "nvidia",
  "groq",
] as const satisfies readonly TProvider[];

const isProvider = (value: unknown): value is TProvider =>
  PROVIDERS.includes(value as TProvider);

/**
 * Returns the language model for `provider`, retried on `fallback` when the
 * primary call fails. Without an explicit `provider`, both come from the
 * `AI_PROVIDER` / `AI_FALLBACK_PROVIDER` vars (default: Gemini, no fallback).
 */
export const getModel = (props: TSwitchProvider) => {
  const {
    c: { env },
    provider,
    fallback,
  } = props;

  const primary =
    provider ?? (isProvider(env.AI_PROVIDER) ? env.AI_PROVIDER : "gemini");
  const secondary = provider
    ? fallback
    : isProvider(env.AI_FALLBACK_PROVIDER)
      ? env.AI_FALLBACK_PROVIDER
      : undefined;

  const model = buildModel({ provider: primary, env });
  if (!secondary || secondary === primary) return model;

  return withFallback({
    model,
    fallback: buildModel({ provider: secondary, env }),
    from: primary,
    to: secondary,
  });
};

const buildModel = ({ provider, env }: TBuildModel): TLanguageModel => {
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

const buildOpenAICompatible = ({ name, env }: TBuildOpenAICompatible) => {
  const { apiKey, baseURL, model } =
    name === "mercury" ? getMercuryConfig(env) : getNvidiaConfig(env);
  return createOpenAICompatible({
    name,
    baseURL,
    headers: { Authorization: `Bearer ${apiKey}` },
  }).chatModel(model);
};

/**
 * Sends the same call to `fallback` when `model` fails before responding
 * (rate limit, 5xx, auth, network). A stream that errors after it has started
 * is not retried: its partial output has already reached the client.
 */
const withFallback = ({ model, fallback, from, to }: TWithFallback) => {
  const shouldFallback = (error: unknown, abortSignal?: AbortSignal) => {
    if (abortSignal?.aborted) return false;
    console.warn(
      JSON.stringify({
        message: "model fallback",
        from,
        to,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  };

  return wrapLanguageModel({
    model,
    middleware: {
      // Download file URLs up front so either provider can read them.
      overrideSupportedUrls: () => ({}),
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate();
        } catch (error) {
          if (!shouldFallback(error, params.abortSignal)) throw error;
          return fallback.doGenerate(params);
        }
      },
      wrapStream: async ({ doStream, params }) => {
        try {
          return await doStream();
        } catch (error) {
          if (!shouldFallback(error, params.abortSignal)) throw error;
          return fallback.doStream(params);
        }
      },
    },
  });
};
