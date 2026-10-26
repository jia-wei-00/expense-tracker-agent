import type { Database } from "@/types/database";

/** A category as offered to the model: the columns `getCategories` selects. */
export type TCategoryOption = Pick<
  Database["public"]["Tables"]["expense_category"]["Row"],
  "id" | "name" | "is_expense"
>;
