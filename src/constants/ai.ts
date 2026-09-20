/** Response header carrying the chat session id. */
export const SESSION_HEADER = "X-Chat-Session-Id";

/** Marker stored in `chat_message.data.kind` for a pending approval row. */
export const PENDING_KIND = "pending_approval";

/** How long a pending approval stays resumable. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
