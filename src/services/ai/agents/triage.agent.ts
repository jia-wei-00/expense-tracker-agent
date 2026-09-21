import type { TContext } from "@/types/common";
import { getModel } from "@/utils/model";
import { ToolLoopAgent } from "ai";
import { expenseTools } from "@/services/ai/tools/expense.tools";
import { getDateTimeNow } from "@/utils/date";

export const TRIAGE_AGENT_NAME = "Expense tracker";

/**
 * Entry-point agent. It routes expense-related requests to the expense
 * subagent via a handoff and handles greetings itself.
 */
export const triageAgent = (c: TContext) => {
  const agent = new ToolLoopAgent({
    model: getModel({ c, provider: "groq" }),
    instructions: `You are the entry point for an expense tracking assistant.
   
    DateTime now:
    ${getDateTimeNow()}

    Rules:
    - Hand off to the "Expense agent" for anything about expenses, income, categories, spending summaries or totals.
    - For greetings or small talk, reply briefly and offer to help track expenses.
    - Never invent financial data and never claim an action succeeded without a tool result.`,
    tools: expenseTools(c),
  });
  return agent;
};
