import {
  getExpenseSummaryTool,
  getExpenseTool,
  listCategoriesTool,
  listExpensesTool,
} from "@/services/ai/tools/expense-read.tools";
import {
  addExpenseTool,
  deleteExpenseTool,
  updateExpenseTool,
} from "@/services/ai/tools/expense-write.tools";
import type { TLedger } from "@/types/ledger";

/**
 * Expense tools scoped to the ledger's user.
 *
 * All data access goes through `ledger`, which filters every query by the
 * user's id; `user_id` is never taken from the model. Outputs use a uniform
 * `{ ok, data | error }` envelope validated by each tool's `outputSchema`.
 *
 * The keys are the stored `tool-<name>` part types: renaming one breaks
 * loading existing chat history.
 */
export const expenseTools = (ledger: TLedger) => ({
  listExpensesCategory: listCategoriesTool(ledger),
  listExpenses: listExpensesTool(ledger),
  getExpense: getExpenseTool(ledger),
  getExpenseSummary: getExpenseSummaryTool(ledger),
  addExpense: addExpenseTool(ledger),
  updateExpense: updateExpenseTool(ledger),
  deleteExpense: deleteExpenseTool(ledger),
});
