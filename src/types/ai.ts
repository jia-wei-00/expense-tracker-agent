import type {
  chatMetadataSchema,
  chatSchema,
  scanResultSchema,
  scanSchema,
} from "@/schemas/ai";
import type { chatAgent } from "@/services/ai/agents/chat.agent";
import type { InferAgentUIMessage } from "ai";
import type { z } from "zod";

export type TAiChat = z.infer<typeof chatSchema>;
export type TAiScan = z.infer<typeof scanSchema>;
export type TScanResult = z.infer<typeof scanResultSchema>;
export type TScanExpense = TScanResult["expenses"][number];
export type TApproval = Extract<TAiChat, { approvals: unknown }>["approvals"][number];

export type TChatMessageMetadata = z.infer<typeof chatMetadataSchema>;

export type TChatAgent = ReturnType<typeof chatAgent>;

/** Tools of the chat agent; stored tool parts are validated against these. */
export type TChatTools = ReturnType<typeof chatAgent>["tools"];

/** A stored chat message, typed by the chat agent's tools. */
export type TChatMessage = InferAgentUIMessage<
  ReturnType<typeof chatAgent>,
  TChatMessageMetadata
>;

export type TChatMessagePart = TChatMessage["parts"][number];
export type TToolPart = Extract<TChatMessagePart, { toolCallId: string }>;
export type TPendingToolPart = Extract<TToolPart, { state: "approval-requested" }>;
