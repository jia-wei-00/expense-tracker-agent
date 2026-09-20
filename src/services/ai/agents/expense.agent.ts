import { expenseTools } from "@/services/ai/tools/expense.tools";
import type { TContext } from "@/types/common";
import { getModel } from "@/utils/model";
import { ToolLoopAgent } from "ai";

export const EXPENSE_AGENT_NAME = "Expense agent";

export const expenseAgent = (c: TContext) => {
  const agent = new ToolLoopAgent({
    model: getModel({ c, provider: "gemini" }),
    tools: [expenseTools],
  });
};
