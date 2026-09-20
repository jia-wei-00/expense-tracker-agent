import { z } from "zod";

/**
 * ISO 8601 datetime that accepts local time (no offset), `Z`, and explicit
 * offsets. Zod's default ISO datetime is UTC-only, but the system prompt tells
 * the model to emit local `YYYY-MM-DDTHH:mm:ss`, which would otherwise fail
 * validation with `InvalidToolInputError`.
 */
const isoDateTime = z.iso.datetime({ offset: true, local: true });

export const listCategoriesSchema = z.object({});

export const listExpensesSchema = z.object({
  from: isoDateTime
    .optional()
    .describe("Inclusive start of the spend_date range, ISO 8601."),
  to: isoDateTime
    .optional()
    .describe("Inclusive end of the spend_date range, ISO 8601."),
  category: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter by expense category id."),
  is_expense: z
    .boolean()
    .optional()
    .describe("true for expenses, false for income. Omit for both."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Maximum number of records to return."),
});

export const getExpenseSchema = z.object({
  id: z.number().int().positive().describe("The expense record id."),
});

export const getExpenseSummarySchema = z.object({
  year: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe("Calendar year, e.g. 2026. Omit for all time."),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("Month number 1-12. Requires year to be meaningful."),
});

export const addExpenseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe(
      'Short transaction label only, no amount/date/filler. E.g. "coffee", "grab ride".',
    ),
  amount: z
    .number()
    .positive()
    .describe("Amount in MYR as a positive number, e.g. 16.5."),
  category: z
    .number()
    .int()
    .positive()
    .describe("Category id from list_expense_categories."),
  is_expense: z
    .boolean()
    .describe(
      "true for expense, false for income. Must match the chosen category.",
    ),
  spend_date: isoDateTime.describe(
    "Transaction datetime in ISO 8601. Use the current datetime when the user gives no date.",
  ),
});

export const updateExpenseSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe("The expense record id to update."),
  name: z.string().min(1).max(80).optional(),
  amount: z.number().positive().optional(),
  category: z.number().int().positive().optional(),
  is_expense: z.boolean().optional(),
  spend_date: isoDateTime.optional(),
});

export const deleteExpenseSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe("The expense record id to delete."),
});

/**
 * Tool outputs share a uniform envelope so the SDK's `outputSchema` validates
 * both the success and error paths at runtime. The SDK only runs Zod *object*
 * schemas as validators, so this stays a plain object rather than a union.
 */
const toolResult = <T extends z.ZodType>(data: T) =>
  z.object({
    ok: z.boolean(),
    data: data.optional(),
    error: z.string().optional(),
  });

const categorySchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  is_expense: z.boolean().nullable(),
});

/** Embedded `expense_category(name)` is a to-one join; allow an array defensively. */
const categoryRefSchema = z
  .union([
    z.object({ name: z.string().nullable() }),
    z.array(z.object({ name: z.string().nullable() })),
  ])
  .nullable();

const expenseRecordSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  amount: z.number().nullable(),
  spend_date: z.string().nullable(),
  is_expense: z.boolean().nullable(),
  category: z.number().int().nullable(),
});

const expenseWithCategorySchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  amount: z.number().nullable(),
  spend_date: z.string().nullable(),
  is_expense: z.boolean().nullable(),
  expense_category: categoryRefSchema,
});

const expenseSummarySchema = z.object({
  balance: z.number(),
  total_income: z.number(),
  total_expenses: z.number(),
});

const deletedRecordSchema = z.object({ id: z.number().int() });

export const listCategoriesOutputSchema = toolResult(z.array(categorySchema));

export const listExpensesOutputSchema = toolResult(
  z.array(expenseWithCategorySchema),
);

export const getExpenseOutputSchema = toolResult(expenseWithCategorySchema);

export const getExpenseSummaryOutputSchema = toolResult(expenseSummarySchema);

export const addExpenseOutputSchema = toolResult(expenseRecordSchema);

export const updateExpenseOutputSchema = toolResult(expenseRecordSchema);

export const deleteExpenseOutputSchema = toolResult(deletedRecordSchema);
