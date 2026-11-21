import type {
  addExpenseOutputSchema,
  addExpenseSchema,
  addExpensesSchema,
  deleteExpenseSchema,
  getExpenseOutputSchema,
  getExpenseSummaryOutputSchema,
  getExpenseSummarySchema,
  listExpensesSchema,
  updateExpenseSchema,
} from "@/schemas/expense";
import type { TSupabaseClient } from "@/types/common";
import type { TablesUpdate } from "@/types/database";
import type { TCategoryOption } from "@/types/expense";
import type { z } from "zod";

/**
 * Either Supabase client: `TSupabaseAdminClient` is the same type, so it is
 * not repeated here. The ledger filters by `user_id` itself, so it is safe
 * with the service-role client too (which bypasses RLS).
 */
export type TLedgerDb = TSupabaseClient;

/** Whose data a ledger reads and writes, and through which client. */
export type TLedgerScope = {
  db: TLedgerDb;
  kv: KVNamespace;
  userId: string;
};

export type TListExpensesInput = z.infer<typeof listExpensesSchema>;
export type TGetExpenseSummaryInput = z.infer<typeof getExpenseSummarySchema>;
export type TAddExpenseInput = z.infer<typeof addExpenseSchema>;
export type TAddExpensesInput = z.infer<typeof addExpensesSchema>;
export type TUpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type TDeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;

/** The columns `updateExpense` may change; never `id` or `user_id`. */
export type TExpensePatch = Pick<
  TablesUpdate<"expense">,
  "name" | "amount" | "category" | "is_expense" | "spend_date"
>;

/** A record with its category name, as the read tools return it. */
export type TLedgerExpense = NonNullable<
  z.infer<typeof getExpenseOutputSchema>["data"]
>;

/** A written record, as the write tools return it. */
export type TLedgerRecord = NonNullable<
  z.infer<typeof addExpenseOutputSchema>["data"]
>[number];

export type TExpenseSummary = NonNullable<
  z.infer<typeof getExpenseSummaryOutputSchema>["data"]
>;

/**
 * The only way the chat agent touches `expense` / `expense_category`. Every
 * method is scoped to one user; methods throw `Error` on a query error.
 */
export type TLedger = {
  categories: () => Promise<TCategoryOption[]>;
  listExpenses: (input: TListExpensesInput) => Promise<TLedgerExpense[]>;
  /** `null` when the record is missing or not the user's. */
  getExpense: (id: number) => Promise<TLedgerExpense | null>;
  summary: (input: TGetExpenseSummaryInput) => Promise<TExpenseSummary>;
  addExpenses: (rows: TAddExpenseInput[]) => Promise<TLedgerRecord[]>;
  /** `null` when the record is missing or not the user's. */
  updateExpense: (
    id: number,
    patch: TExpensePatch,
  ) => Promise<TLedgerRecord | null>;
  /** The ids actually deleted; ids that are missing or not the user's are left out. */
  deleteExpenses: (ids: number[]) => Promise<Array<{ id: number }>>;
};
