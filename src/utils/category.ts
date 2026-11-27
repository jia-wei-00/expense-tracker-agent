import type { TCategoryOption } from "@/types/expense";

/**
 * The ids in `ids` that are not among `own` (the user's categories), each
 * once, in first-seen order.
 */
export const findUnknownCategoryIds = (own: TCategoryOption[], ids: number[]) => {
  const ownIds = new Set(own.map((category) => category.id));
  return [...new Set(ids)].filter((id) => !ownIds.has(id));
};
