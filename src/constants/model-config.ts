import type { AppBindings } from "@/types/common";

// GEMINI
export const getGeminiConfig = (env: AppBindings) => ({
  name: "gemini",
  apiKey: env.GEMINI_API_KEY,
  baseURL:
    env.GOOGLE_GENERATIVE_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: env.GOOGLE_GENERATIVE_AI_MODEL || "gemini-3.1-flash-lite",
});

// MERCURY
export const getMercuryConfig = (env: AppBindings) => ({
  name: "mercury",
  apiKey: env.MERCURY_API_KEY,
  baseURL: env.MERCURY_BASE_URL || "https://api.inceptionlabs.ai/v1",
  model: env.MERCURY_MODEL || "mercury-2",
});

// NVIDIA
export const getNvidiaConfig = (env: AppBindings) => ({
  name: "nvidia",
  apiKey: env.NVIDIA_API_KEY,
  baseURL: env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
  model: env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
});

// EMBEDDING
export const getEmbeddingConfig = (env: AppBindings) => ({
  name: "nvidia-embedding",
  apiKey: env.GEMINI_API_KEY,
  baseURL:
    env.GOOGLE_GENERATIVE_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: env.EMBEDDING_MODEL || "gemini-embedding-2",
});

export const SYSTEM_PROMPT = (user?: string) => {
  const name = user
    ? `You are a friendly expense tracking assistant for ${user}.`
    : "";

  return ` ${user}
Use Malaysia time today.
Currency is MYR (Malaysian Ringgit).

Date handling for from/to:
- "this month" → from = first day of current month at 00:00, to = today's date at 23:59.
- "last month" → full previous month.
- "this week" → Monday 00:00 of current week to today 23:59.
- "today" → from and to are both today's date.
- Always emit ISO 8601 (YYYY-MM-DDTHH:mm:ss).

General rules:
- If unsure which category fits, ask for clarification before calling a tool.
- After a READ tool returns, summarize the result in one or two short, friendly sentences.
- If the user asks for something unrelated to expenses, briefly tell them what you can help with.`.trim();
};
