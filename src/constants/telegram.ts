export const TELEGRAM_MESSAGE_MAX = 4096;
export const SESSION_IDLE_ROTATE_MS = 3 * 60 * 60 * 1000;
export const TELEGRAM_IP_RANGES = ["149.154.160.0/20", "91.108.4.0/22"];
export const PHOTO_MAX_SIDE = 1280;
export const TELEGRAM_FILE_PREFIX = "telegram-file:";
// Image types the `chat-images` bucket accepts; a document of any other type is unsupported.
export const ACCEPTED_IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// Telegram re-encodes every photo as JPEG.
export const PHOTO_MEDIA_TYPE = "image/jpeg";
export const CALLBACK_PREFIX = "apv";
export const INBOX_MAX_ATTEMPTS = 3;
export const INBOX_RUN_BUDGET_MS = 10 * 60 * 1000;
// How long a processed update_id is remembered so a late redelivery is ignored.
export const INBOX_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
export const TYPING_INTERVAL_MS = 4000;
export const LINK_TOKEN_LENGTH = 32;
export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

export const TELEGRAM_COPY = {
  unlinked: "Link your account: open the app → Settings → Telegram.",
  needsPlan: "AI chat needs a Plus or Pro plan.",
  quotaUsed: (quota: number) => `You've used this month's ${quota} messages.`,
  unsupportedMedia: "I can read text and photos for now.",
  poisonUpdate: "Something went wrong with that message, please send it again.",
  linkOk: "Linked. Send me an expense any time.",
  linkBadToken: "That link expired. Open Settings → Telegram in the app again.",
  linkTaken: "This Telegram account is linked to another user.",
  approvalExpired: "Expired after 10 minutes.",
  approvalAnswered: "Already answered.",
  newConversation: "Started a new conversation.",
  help: 'Send me an expense like "lunch 12" or a receipt photo. Link your account first: open the app → Settings → Telegram.',
  // Placeholder for update kinds a later slice implements.
  comingSoon: "Coming soon.",
} as const;
