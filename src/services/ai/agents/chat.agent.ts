import { AGENT_MAX_STEPS } from "@/constants/ai";
import { chatInstructions } from "@/services/ai/prompts/chat.prompt";
import { expenseTools } from "@/services/ai/tools/expense.tools";
import type { TContext } from "@/types/common";
import { getDateTimeNow } from "@/utils/date";
import { getModel } from "@/utils/model";
import * as ai from "ai";
import { isStepCount } from "ai";
import { wrapAISDK } from "braintrust";

const { ToolLoopAgent } = wrapAISDK(ai);

/**
 * The chat agent. It answers expense/income questions and proposes changes
 * with the expense tools directly; write tools stop the run for approval.
 */
export const chatAgent = (c: TContext) => {
  const agent = new ToolLoopAgent({
    model: getModel({ c }),
    instructions: chatInstructions({ now: getDateTimeNow() }),
    tools: expenseTools(c),
    stopWhen: isStepCount(AGENT_MAX_STEPS),
  });
  return agent;
};
