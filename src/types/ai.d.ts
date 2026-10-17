import { chatMetadataSchema, chatSchema, scanSchema } from "@/schemas/ai";
import type { chatAgent } from "@/services/ai/agents/chat.agent";
import type { InferAgentUIMessage } from "ai";
import { z } from "zod";

export type TAiChat = z.infer<typeof chatSchema>;
export type TAiScan = z.infer<typeof scanSchema>;
export type TApproval = Extract<TAiChat, { approvals: unknown }>["approvals"][number];

export type TChatMessageMetadata = z.infer<typeof chatMetadataSchema>;

/** Tools of the chat agent; stored tool parts are validated against these. */
export type TChatTools = ReturnType<typeof chatAgent>["tools"];

/** A stored chat message, typed by the chat agent's tools. */
export type TChatMessage = InferAgentUIMessage<
  ReturnType<typeof chatAgent>,
  TChatMessageMetadata
>;
