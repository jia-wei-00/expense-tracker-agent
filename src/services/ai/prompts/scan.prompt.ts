import type { TCategoryOption } from "@/types/expense";

/**
 * System instructions for receipt extraction. `now` is the current local
 * date-time used when the receipt shows no date; `categories` are the user's
 * own category rows the model must pick from.
 */
export const scanInstructions = ({
  now,
  categories,
}: {
  now: string;
  categories: TCategoryOption[];
}) =>
  `Extract the single expense or income transaction shown in the receipt image.

DateTime now:
${now}

Categories (id, name, is_expense):
${JSON.stringify(categories)}

Rules:
- Use the receipt total as the amount.
- Pick the best matching category id and set is_expense to match it.
- Use the receipt date; fall back to the current datetime if none is visible.`;
