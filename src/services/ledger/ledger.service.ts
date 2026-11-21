import { CACHE_TTL } from "@/constants/cache";
import { cacheKey, getOrSet } from "@/libs/cache";
import type {
  TAddExpenseInput,
  TExpensePatch,
  TGetExpenseSummaryInput,
  TLedger,
  TLedgerScope,
  TListExpensesInput,
} from "@/types/ledger";

// Every query below filters on `user_id` (and every insert sets it) because
// the service-role client bypasses RLS: these filters are what keep one user
// from reading or changing another's records.

const EXPENSE_WITH_CATEGORY =
  "id, name, amount, spend_date, is_expense, expense_category(name)";
const EXPENSE_RECORD = "id, name, amount, spend_date, is_expense, category";

/** The user's categories, read through the per-user KV cache. */
const categories = ({ db, kv, userId }: TLedgerScope) =>
  getOrSet(kv, cacheKey("categories", userId), CACHE_TTL.CATEGORIES, async () => {
    const { data, error } = await db
      .from("expense_category")
      .select("id, name, is_expense")
      .eq("user_id", userId)
      .order("name");

    if (error) throw new Error(error.message);
    return data;
  });

const listExpenses = async (
  { db, userId }: TLedgerScope,
  { from, to, category, is_expense, limit }: TListExpensesInput,
) => {
  let query = db
    .from("expense")
    .select(EXPENSE_WITH_CATEGORY)
    .eq("user_id", userId)
    .order("spend_date", { ascending: false })
    .limit(limit);

  if (category !== undefined) query = query.eq("category", category);
  if (is_expense !== undefined) query = query.eq("is_expense", is_expense);
  if (from) query = query.gte("spend_date", from);
  if (to) query = query.lte("spend_date", to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

const getExpense = async ({ db, userId }: TLedgerScope, id: number) => {
  const { data, error } = await db
    .from("expense")
    .select(EXPENSE_WITH_CATEGORY)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
};

const summary = async (
  { db, userId }: TLedgerScope,
  { year, month }: TGetExpenseSummaryInput,
) => {
  // `get_expense_stats` filters on `p_user_id` itself.
  const { data, error } = await db.rpc("get_expense_stats", {
    p_user_id: userId,
    p_year: year,
    p_month: month,
  });

  if (error) throw new Error(error.message);
  return data[0] ?? { balance: 0, total_income: 0, total_expenses: 0 };
};

/** One bulk insert: PostgREST writes the whole batch or none of it. */
const addExpenses = async (
  { db, userId }: TLedgerScope,
  rows: TAddExpenseInput[],
) => {
  const { data, error } = await db
    .from("expense")
    .insert(rows.map((row) => ({ ...row, user_id: userId })))
    .select(EXPENSE_RECORD);

  if (error) throw new Error(error.message);
  return data;
};

const updateExpense = async (
  { db, userId }: TLedgerScope,
  id: number,
  { name, amount, category, is_expense, spend_date }: TExpensePatch,
) => {
  // Copied field by field so a wider object can never change `id` or `user_id`.
  const { data, error } = await db
    .from("expense")
    .update({ name, amount, category, is_expense, spend_date })
    .eq("id", id)
    .eq("user_id", userId)
    .select(EXPENSE_RECORD)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
};

const deleteExpenses = async ({ db, userId }: TLedgerScope, ids: number[]) => {
  const { data, error } = await db
    .from("expense")
    .delete()
    .in("id", ids)
    .eq("user_id", userId)
    .select("id");

  if (error) throw new Error(error.message);
  return data;
};

/**
 * The agent's only access to `expense` / `expense_category`, scoped to
 * `userId`. Works with the user-scoped or the service-role client.
 */
export const createLedger = (scope: TLedgerScope): TLedger => ({
  categories: () => categories(scope),
  listExpenses: (input) => listExpenses(scope, input),
  getExpense: (id) => getExpense(scope, id),
  summary: (input) => summary(scope, input),
  addExpenses: (rows) => addExpenses(scope, rows),
  updateExpense: (id, patch) => updateExpense(scope, id, patch),
  deleteExpenses: (ids) => deleteExpenses(scope, ids),
});
