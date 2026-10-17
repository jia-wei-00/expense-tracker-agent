import { z } from "zod";

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(4000),
});

const filePartSchema = z.object({
  type: z.literal("file"),
  mediaType: z.string().regex(/^(image|audio)\//),
  url: z.url({ protocol: /^(https|data)$/ }),
  filename: z.string().max(255).optional(),
});

/**
 * The only message a client may submit: a user turn with text/file parts.
 * Assistant and tool parts always come from the stored history, never the
 * client, so it cannot forge tool calls or results.
 */
const userMessageSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.literal("user"),
  parts: z
    .array(z.discriminatedUnion("type", [textPartSchema, filePartSchema]))
    .min(1),
});

const approvalsSchema = z
  .array(
    z.object({
      callId: z.string().min(1),
      approve: z.boolean(),
    }),
  )
  .min(1);

/** `POST /ai/chat`: either a new user message or answers to pending approvals. */
export const chatSchema = z.union([
  z.object({ sessionId: z.uuid(), message: userMessageSchema }),
  z.object({ sessionId: z.uuid(), approvals: approvalsSchema }),
]);

/** `UIMessage.metadata` on stored chat messages. */
export const chatMetadataSchema = z.object({
  /** Set by the backend on every write; used for approval expiry. */
  savedAt: z.iso.datetime().optional(),
  /** Token usage of the assistant turn, attached on `finish`. */
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .optional(),
});

/** `POST /ai/scan`: a receipt image to extract a single expense from. */
export const scanSchema = z.object({
  url: z.url({ protocol: /^(https|data)$/ }),
  mediaType: z.string().regex(/^image\//),
});
