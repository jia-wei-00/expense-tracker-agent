import { errorResponse } from "@/libs/response";
import { triageAgent } from "@/services/ai/agents/triage.agent";
import { TAiPrompt } from "@/types/ai";
import type { ValidContext } from "@/types/common";
import { createAgentUIStreamResponse } from "ai";

export async function aiPrompt(c: ValidContext<TAiPrompt>) {
  const { messages } = c.req.valid("json");
  // const supabase = c.var.supabaseContext.supabase;

  try {
    const agent = triageAgent(c);
    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
    });
  } catch (error) {
    console.error("aiPrompt failed:", error);
    return errorResponse(c);
  }
}
