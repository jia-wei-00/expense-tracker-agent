import { errorResponse } from "@/libs/response";
import { TAiPrompt } from "@/types/ai";
import { ValidContext } from "@/types/common";
import { createAgent } from "@/utils/model";
import { createAiSdkUiMessageStreamResponse } from "@openai/agents-extensions/ai-sdk-ui";

export async function aiPrompt(c: ValidContext<TAiPrompt>) {
  const {
    req,
    var: { supabaseContext },
  } = c;
  const input = req.valid("json");
  const user = supabaseContext.userClaims?.email;
  try {
    const result = await createAgent({
      c,
      input,
      name: "Expense tracker agent",
      instructions: `You are a friendly expense tracking assistant for ${user}. You need to help ${user} to manage their expenses in the app`,
      tools: [],
    });
    return createAiSdkUiMessageStreamResponse(result);
  } catch (error) {
    return errorResponse(c);
  }
}
