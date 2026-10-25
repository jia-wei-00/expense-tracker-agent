/** How long a pending approval stays resumable. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** Most recent stored messages replayed to the model per turn. */
export const CHAT_HISTORY_LIMIT = 40;

/** Max model steps (LLM calls) per agent run before it is stopped. */
export const AGENT_MAX_STEPS = 10;

/** Max length of a session title derived from the first user message. */
export const TITLE_MAX_LENGTH = 60;

/** Denial reason for a rejected tool call; without one some models read the denial as success. */
export const REJECTED_REASON = "The user rejected this action. Nothing was saved.";

/** Denial reason for pending tool calls cancelled by a new user message. */
export const SUPERSEDED_REASON = "The user sent a new message instead of answering.";

/** `chat_message.type` for each `UIMessage` role (column has a check constraint). */
export const MESSAGE_TYPE_BY_ROLE = {
  user: "human",
  assistant: "ai",
  system: "system",
} as const;
