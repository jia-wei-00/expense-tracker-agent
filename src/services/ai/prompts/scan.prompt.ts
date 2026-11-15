import type { TCategoryOption } from "@/types/expense";

/**
 * System instructions for receipt extraction. `now` is the current Malaysia
 * local date-time (`YYYY-MM-DDTHH:mm:ss`) used when the receipt shows no date;
 * `categories` are the user's own category rows the model must pick from.
 */
export const scanInstructions = ({
  now,
  categories,
}: {
  now: string;
  categories: TCategoryOption[];
}) =>
  `Extract the transaction shown in the receipt image as expense records, one per category.

DateTime now (Malaysia time):
${now}

Categories (id, name, is_expense):
${JSON.stringify(categories)}

Rules:
- total is the amount actually paid, after tax, service charge, discounts and rounding.
- Group the line items by category: one record per category, its amount the sum of that category's items. A receipt whose items all fit one category is a single record.
- Spread tax, service charge, discounts and rounding across the records in proportion to their amounts, so the records add up to total.
- name is a short label for what the record covers, e.g. "groceries", "detergent & tissue".
- Pick the best matching category id for each record and set is_expense to match it.
- spend_date is the receipt's date and time in exactly the format of DateTime now (Malaysia time, no offset). Every record uses the same spend_date. Use 00:00:00 when the receipt shows a date but no time, and DateTime now when it shows no date.`;
