import type { TAppBindings } from "@/types/common";
import type { wrapLanguageModel } from "ai";

export type TProvider = "gemini" | "mercury" | "nvidia" | "groq" | "anthropic";

export type TSwitchProvider = {
  env: TAppBindings;
  /** Overrides `AI_PROVIDER`. */
  provider?: TProvider;
  /** Provider retried when `provider` fails. Ignored without `provider`. */
  fallback?: TProvider;
};

/** An AI SDK (spec v4) language model, which every provider here returns. */
export type TLanguageModel = ReturnType<typeof wrapLanguageModel>;

export type TBuildModel = {
  provider: TProvider;
  env: TAppBindings;
};

export type TBuildOpenAICompatible = {
  name: "mercury" | "nvidia";
  env: TAppBindings;
};

export type TWithFallback = {
  model: TLanguageModel;
  fallback: TLanguageModel;
  from: TProvider;
  to: TProvider;
};
