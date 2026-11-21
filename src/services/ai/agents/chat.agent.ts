import { AGENT_MAX_STEPS } from "@/constants/ai";
import { chatInstructions } from "@/services/ai/prompts/chat.prompt";
import { expenseTools } from "@/services/ai/tools/expense.tools";
import type { TChatChannel } from "@/types/chat";
import type { TAppBindings } from "@/types/common";
import type { TLedger } from "@/types/ledger";
import { getModel } from "@/utils/model";
import * as ai from "ai";
import { isStepCount } from "ai";
import { wrapAISDK } from "braintrust";

const { ToolLoopAgent } = wrapAISDK(ai);

/**
 * The chat agent. It answers expense/income questions and proposes changes
 * with the expense tools directly; write tools stop the run for approval.
 * Needs no request context, so it runs outside a Hono handler too.
 */
export const chatAgent = ({
  env,
  ledger,
  channel,
}: {
  env: TAppBindings;
  ledger: TLedger;
  channel: TChatChannel;
}) => {
  const agent = new ToolLoopAgent({
    model: getModel({ env }),
    instructions: chatInstructions({ channel }),
    tools: expenseTools(ledger),
    stopWhen: isStepCount(AGENT_MAX_STEPS),
  });
  return agent;
};
