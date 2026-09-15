import { TContext } from "@/types/common";
import { Agent } from "@openai/agents";

const expenseTrackerAgent = (c: TContext) => {
  const {
    var: { supabaseContext },
  } = c;
  const user = supabaseContext.userClaims?.email;

  return new Agent({
    name: "Expense tracker agent",
    instructions: `You are a friendly expense tracking assistant for ${user}. You need to help ${user} to manage their expenses in the app`,
  });
};
