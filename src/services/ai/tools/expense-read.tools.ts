import {
  getExpenseOutputSchema,
  getExpenseSchema,
  getExpenseSummaryOutputSchema,
  getExpenseSummarySchema,
  listCategoriesOutputSchema,
  listCategoriesSchema,
  listExpensesOutputSchema,
  listExpensesSchema,
} from "@/schemas/expense";
import type { TLedger } from "@/types/ledger";
import { toMessage } from "@/utils/error";
import { toModelOutput } from "@/utils/tool-output";
import { tool } from "ai";

export const listCategoriesTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "list_expense_categories" },
    description:
      "List the user's expense and income categories. Call this before add/update so you can pass the correct category id.",
    inputSchema: listCategoriesSchema,
    outputSchema: listCategoriesOutputSchema,
    toModelOutput,
    execute: async () => {
      try {
        return { ok: true, data: await ledger.categories() };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });

export const listExpensesTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "list_expenses" },
    description:
      "List the user's expense/income records, newest first, with optional filters.",
    inputSchema: listExpensesSchema,
    outputSchema: listExpensesOutputSchema,
    toModelOutput,
    execute: async (input) => {
      try {
        return { ok: true, data: await ledger.listExpenses(input) };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });

export const getExpenseTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "get_expense" },
    description: "Fetch a single expense/income record by id.",
    inputSchema: getExpenseSchema,
    outputSchema: getExpenseOutputSchema,
    toModelOutput,
    execute: async ({ id }) => {
      try {
        const data = await ledger.getExpense(id);
        if (!data) return { ok: false, error: `No expense found with id ${id}` };
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });

export const getExpenseSummaryTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "get_expense_summary" },
    description:
      "Get the user's balance, total income and total expenses for an optional year/month.",
    inputSchema: getExpenseSummarySchema,
    outputSchema: getExpenseSummaryOutputSchema,
    toModelOutput,
    execute: async (input) => {
      try {
        return { ok: true, data: await ledger.summary(input) };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });
