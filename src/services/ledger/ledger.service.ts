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
import { findUnknownCategoryIds } from "@/utils/category";

// Every query below filters on `user_id` (and every insert sets it) because
// the service-role client bypasses RLS: these filters are what keep one user
// from reading or changing another's records.
//
// Reads that embed `expense_category(name)` also filter the embed by
// `expense_category.user_id`: a row can reference another user's category
// (the FK check ignores ownership), and the embed must not show its name.
// Without `!inner` that filter only nulls a foreign embed; it never drops the
// expense row itself.

const EXPENSE_WITH_CATEGORY =
  "id, name, amount, spend_date, is_expense, expense_category(name)";
const EXPENSE_RECORD = "id, name, amount, spend_date, is_expense, category";

/**
 * The user's categories, read through the per-user KV cache. The key is
 * versioned: values under the old key came from a loader that did not filter
 * by `user_id`, and may hold other users' categories.
 */
const categories = ({ db, kv, userId }: TLedgerScope) =>
  getOrSet(kv, cacheKey("categories", "v2", userId), CACHE_TTL.CATEGORIES, async () => {
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
    .eq("expense_category.user_id", userId)
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
    .eq("expense_category.user_id", userId)
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

/**
 * Throws unless every id is one of the user's categories. The category ids
 * come from the model, and `expense_category` is readable by every user, so
 * without this a record could point at (and later show) another user's
 * category.
 */
const assertOwnCategories = async (scope: TLedgerScope, ids: number[]) => {
  const unknown = findUnknownCategoryIds(await categories(scope), ids);
  if (unknown.length === 0) return;
  const label = unknown.length === 1 ? "id" : "ids";
  throw new Error(`Unknown category ${label} ${unknown.join(", ")}`);
};

/** One bulk insert: PostgREST writes the whole batch or none of it. */
const addExpenses = async (scope: TLedgerScope, rows: TAddExpenseInput[]) => {
  const { db, userId } = scope;
  await assertOwnCategories(scope, rows.map((row) => row.category));

  const { data, error } = await db
    .from("expense")
    // Copied field by field, like `updateExpense`, so nothing but these
    // columns (and our `user_id`) is ever written.
    .insert(
      rows.map(({ name, amount, category, is_expense, spend_date }) => ({
        name,
        amount,
        category,
        is_expense,
        spend_date,
        user_id: userId,
      })),
    )
    .select(EXPENSE_RECORD);

  if (error) throw new Error(error.message);
  return data;
};

const updateExpense = async (
  scope: TLedgerScope,
  id: number,
  { name, amount, category, is_expense, spend_date }: TExpensePatch,
) => {
  const { db, userId } = scope;
  // `null` clears the category, which points at nobody's category.
  if (category != null) await assertOwnCategories(scope, [category]);

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
