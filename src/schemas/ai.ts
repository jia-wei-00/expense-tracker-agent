import { UIMessage } from "ai";
import { z } from "zod";

export const promptSchema = z.object({
  messages: z.array(z.custom<UIMessage>()).min(1),
});

export const approvalSchema = z.object({
  sessionId: z.string().uuid(),
  approvals: z
    .array(
      z.object({
        callId: z.string().min(1),
        approve: z.boolean(),
      }),
    )
    .min(1),
});

export const pendingQuerySchema = z.object({
  sessionId: z.string().uuid(),
});
