import { CACHE_TTL } from "@/constants/cache";
import { cacheKey, getOrSet } from "@/libs/cache";
import {
  addExpenseOutputSchema,
  addExpenseSchema,
  deleteExpenseOutputSchema,
  deleteExpenseSchema,
  getExpenseOutputSchema,
  getExpenseSchema,
  getExpenseSummaryOutputSchema,
  getExpenseSummarySchema,
  listCategoriesOutputSchema,
  listCategoriesSchema,
  listExpensesOutputSchema,
  listExpensesSchema,
  updateExpenseOutputSchema,
  updateExpenseSchema,
} from "@/schemas/expense";
import type { TContext } from "@/types/common";
import type { TablesUpdate } from "@/types/database";
import { tool } from "ai";

/** Best-effort human-readable message from an unknown thrown value. */
const toMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Surfaces validation failures to the model so it can correct the arguments
 * and retry within the same run, instead of the run hard-failing.
 *
 * Tools declare an `outputSchema`, so this must return the same envelope shape
 * (`{ ok, error }`) rather than a bare string, or the SDK rejects it.
 */
const toolErrorFunction = (_context: unknown, error: unknown) => {
  const original = (error as { originalError?: unknown } | undefined)
    ?.originalError;
  const detail =
    original instanceof Error
      ? original.message
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    ok: false,
    error: `Invalid tool arguments: ${detail}. Fix the arguments and call the tool again.`,
  };
};

/**
 * Expense tools scoped to the authenticated user.
 *
 * Every query runs through the user-scoped Supabase client so RLS enforces
 * ownership; `user_id` is never taken from the model. Outputs use a uniform
 * `{ ok, data | error }` envelope validated by each tool's `outputSchema`.
 */
export const expenseTools = (c: TContext) => {
  const supabase = c.var.supabaseContext.supabase;
  const userId = c.var.supabaseContext.userClaims?.id;
  const kv = c.env.CACHE;

  return {
    listExpensesCategory: tool({
      metadata: { name: "list_expense_categories" },
      description:
        "List the user's expense and income categories. Call this before add/update so you can pass the correct category id.",
      inputSchema: listCategoriesSchema,
      outputSchema: listCategoriesOutputSchema,
      execute: async () => {
        if (!userId) return { ok: false, error: "Not authenticated" };

        try {
          const data = await getOrSet(
            kv,
            cacheKey("categories", userId),
            CACHE_TTL.CATEGORIES,
            async () => {
              const { data, error } = await supabase
                .from("expense_category")
                .select("id, name, is_expense")
                .order("name");

              if (error) throw new Error(error.message);
              return data;
            },
          );

          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: toMessage(error) };
        }
      },
    }),

    listExpenses: tool({
      metadata: { name: "list_expenses" },
      description:
        "List the user's expense/income records, newest first, with optional filters.",
      inputSchema: listExpensesSchema,
      outputSchema: listExpensesOutputSchema,
      execute: async ({ from, to, category, is_expense, limit }) => {
        let query = supabase
          .from("expense")
          .select(
            "id, name, amount, spend_date, is_expense, expense_category(name)",
          )
          .order("spend_date", { ascending: false })
          .limit(limit ?? 10);

        if (category !== undefined) query = query.eq("category", category);
        if (is_expense !== undefined)
          query = query.eq("is_expense", is_expense);
        if (from) query = query.gte("spend_date", from);
        if (to) query = query.lte("spend_date", to);

        const { data, error } = await query;
        if (error) return { ok: false, error: error.message };
        return { ok: true, data };
      },
    }),

    getExpense: tool({
      metadata: { name: "get_expense" },
      description: "Fetch a single expense/income record by id.",
      inputSchema: getExpenseSchema,
      outputSchema: getExpenseOutputSchema,
      execute: async ({ id }) => {
        const { data, error } = await supabase
          .from("expense")
          .select(
            "id, name, amount, spend_date, is_expense, expense_category(name)",
          )
          .eq("id", id)
          .maybeSingle();

        if (error) return { ok: false, error: error.message };
        if (!data)
          return { ok: false, error: `No expense found with id ${id}` };
        return { ok: true, data };
      },
    }),

    getExpenseSummary: tool({
      metadata: { name: "get_expense_summary" },
      description:
        "Get the user's balance, total income and total expenses for an optional year/month.",
      inputSchema: getExpenseSummarySchema,
      outputSchema: getExpenseSummaryOutputSchema,
      execute: async ({ year, month }) => {
        if (!userId) return { ok: false, error: "Not authenticated" };

        const { data, error } = await supabase.rpc("get_expense_stats", {
          p_user_id: userId,
          p_year: year,
          p_month: month,
        });

        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          data: data?.[0] ?? {
            balance: 0,
            total_income: 0,
            total_expenses: 0,
          },
        };
      },
    }),

    addExpense: tool({
      metadata: { name: "add_expense" },
      description:
        "Create an expense or income record. Requires human approval before it is written.",
      inputSchema: addExpenseSchema,
      outputSchema: addExpenseOutputSchema,
      needsApproval: true,
      execute: async ({ name, amount, category, is_expense, spend_date }) => {
        const { data, error } = await supabase
          .from("expense")
          .insert({ name, amount, category, is_expense, spend_date })
          .select("id, name, amount, spend_date, is_expense, category")
          .single();

        if (error) return { ok: false, error: error.message };
        return { ok: true, data };
      },
    }),

    updateExpense: tool({
      metadata: { name: "update_expense" },
      description:
        "Update an existing expense/income record. Requires human approval before it is written.",
      inputSchema: updateExpenseSchema,
      outputSchema: updateExpenseOutputSchema,
      needsApproval: true,
      execute: async ({
        id,
        name,
        amount,
        category,
        is_expense,
        spend_date,
      }) => {
        const patch: TablesUpdate<"expense"> = {};

        if (name !== undefined) patch.name = name;
        if (amount !== undefined) patch.amount = amount;
        if (category !== undefined) patch.category = category;
        if (is_expense !== undefined) patch.is_expense = is_expense;
        if (spend_date !== undefined) patch.spend_date = spend_date;

        if (Object.keys(patch).length === 0) {
          return { ok: false, error: "No fields to update" };
        }

        const { data, error } = await supabase
          .from("expense")
          .update(patch)
          .eq("id", id)
          .select("id, name, amount, spend_date, is_expense, category")
          .maybeSingle();

        if (error) return { ok: false, error: error.message };
        if (!data)
          return { ok: false, error: `No expense found with id ${id}` };
        return { ok: true, data };
      },
    }),

    deleteExpense: tool({
      metadata: { name: "delete_expense" },
      description:
        "Delete an expense/income record by id. Requires human approval before it is written.",
      inputSchema: deleteExpenseSchema,
      outputSchema: deleteExpenseOutputSchema,
      needsApproval: true,
      execute: async ({ id }) => {
        const { data, error } = await supabase
          .from("expense")
          .delete()
          .eq("id", id)
          .select("id")
          .maybeSingle();

        if (error) return { ok: false, error: error.message };
        if (!data)
          return { ok: false, error: `No expense found with id ${id}` };
        return { ok: true, data };
      },
    }),
  };
};
