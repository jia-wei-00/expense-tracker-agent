import { errorResponse } from "@/libs/response";
import { TAiPrompt } from "../../types/ai";
import { ValidContext } from "../../types/common";
import { createGenAiAgent } from "./model";
import { runStreamedAgent } from "./agent";
import { createAiSdkUiMessageStreamResponse } from "@openai/agents-extensions/ai-sdk-ui";
import { SYSTEM_PROMPT } from "@/constants/model-config";

export async function aiPrompt(c: ValidContext<TAiPrompt>) {
  const {
    env,
    req,
    var: { supabaseContext },
  } = c;
  const input = req.valid("json");
  const user = supabaseContext.userClaims?.email;
  try {
    const client = createGenAiAgent({
      env,
      instructions: SYSTEM_PROMPT(user),
    });
    const result = await runStreamedAgent(c, client, input);
    return createAiSdkUiMessageStreamResponse(result);
  } catch (error) {
    return errorResponse(c);
  }
}
