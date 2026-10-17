/** How long a pending approval stays resumable. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** Most recent stored messages replayed to the model per turn. */
export const CHAT_HISTORY_LIMIT = 40;

/** Max length of a session title derived from the first user message. */
export const TITLE_MAX_LENGTH = 60;

/** `chat_message.type` for each `UIMessage` role (column has a check constraint). */
export const MESSAGE_TYPE_BY_ROLE = {
  user: "human",
  assistant: "ai",
  system: "system",
} as const;
