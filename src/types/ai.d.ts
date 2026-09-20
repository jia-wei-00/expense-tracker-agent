import { approvalSchema, pendingQuerySchema, promptSchema } from "@/schemas/ai";
import type { UIMessage } from "ai";
import { z } from "zod";

export type TAiPrompt = z.infer<typeof promptSchema>;
export type TApprovalPrompt = z.infer<typeof approvalSchema>;
export type TPendingQuery = z.infer<typeof pendingQuerySchema>;
