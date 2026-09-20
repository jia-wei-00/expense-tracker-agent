import type { AppBindings } from "@/types/common";

// GEMINI
export const getGeminiConfig = (env: AppBindings) => ({
  apiKey: env.GEMINI_API_KEY,
  baseURL:
    env.GOOGLE_GENERATIVE_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: env.GOOGLE_GENERATIVE_AI_MODEL || "gemini-3.5-flash-lite",
});

// MERCURY
export const getMercuryConfig = (env: AppBindings) => ({
  apiKey: env.MERCURY_API_KEY,
  baseURL: env.MERCURY_BASE_URL || "https://api.inceptionlabs.ai/v1",
  model: env.MERCURY_MODEL || "mercury-2",
});

// NVIDIA
export const getNvidiaConfig = (env: AppBindings) => ({
  apiKey: env.NVIDIA_API_KEY,
  baseURL: env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
  model: env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
});

// EMBEDDING
export const getEmbeddingConfig = (env: AppBindings) => ({
  apiKey: env.GEMINI_API_KEY,
  baseURL:
    env.GOOGLE_GENERATIVE_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: env.EMBEDDING_MODEL || "gemini-embedding-2",
});
