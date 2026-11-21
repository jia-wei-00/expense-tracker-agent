import {
  addExpenseOutputSchema,
  addExpensesSchema,
  deleteExpenseOutputSchema,
  deleteExpenseSchema,
  updateExpenseOutputSchema,
  updateExpenseSchema,
} from "@/schemas/expense";
import type { TExpensePatch, TLedger } from "@/types/ledger";
import { toMessage } from "@/utils/error";
import { toModelOutput } from "@/utils/tool-output";
import { tool } from "ai";

export const addExpenseTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "add_expense" },
    description:
      "Create one or more expense/income records in a single call (one approval for all). Returns the created records. Requires human approval before it is written.",
    inputSchema: addExpensesSchema,
    outputSchema: addExpenseOutputSchema,
    toModelOutput,
    needsApproval: true,
    execute: async ({ expenses }) => {
      try {
        return { ok: true, data: await ledger.addExpenses(expenses) };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });

export const updateExpenseTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "update_expense" },
    description:
      "Update an existing expense/income record. Requires human approval before it is written.",
    inputSchema: updateExpenseSchema,
    outputSchema: updateExpenseOutputSchema,
    toModelOutput,
    needsApproval: true,
    execute: async ({ id, name, amount, category, is_expense, spend_date }) => {
      const patch: TExpensePatch = {};

      if (name !== undefined) patch.name = name;
      if (amount !== undefined) patch.amount = amount;
      if (category !== undefined) patch.category = category;
      if (is_expense !== undefined) patch.is_expense = is_expense;
      if (spend_date !== undefined) patch.spend_date = spend_date;

      if (Object.keys(patch).length === 0) {
        return { ok: false, error: "No fields to update" };
      }

      try {
        const data = await ledger.updateExpense(id, patch);
        if (!data) return { ok: false, error: `No expense found with id ${id}` };
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });

export const deleteExpenseTool = (ledger: TLedger) =>
  tool({
    metadata: { name: "delete_expense" },
    description:
      "Delete one or more expense/income records by id in a single call (one approval for all). Returns the deleted ids; ids that were not found are listed in `error`. Requires human approval before it is written.",
    inputSchema: deleteExpenseSchema,
    outputSchema: deleteExpenseOutputSchema,
    toModelOutput,
    needsApproval: true,
    execute: async ({ ids }) => {
      try {
        const data = await ledger.deleteExpenses(ids);
        if (data.length === 0) {
          return { ok: false, error: `No expenses found with ids ${ids.join(", ")}` };
        }

        const missing = ids.filter((id) => !data.some((row) => row.id === id));
        if (missing.length === 0) return { ok: true, data };
        return { ok: true, data, error: `Not found: ${missing.join(", ")}` };
      } catch (error) {
        return { ok: false, error: toMessage(error) };
      }
    },
  });
