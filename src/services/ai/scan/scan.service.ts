import { scanResultSchema } from "@/schemas/ai";
import { scanInstructions } from "@/services/ai/prompts/scan.prompt";
import type { TAiScan, TScanExpense } from "@/types/ai";
import type { TAppBindings } from "@/types/common";
import type { TLedger } from "@/types/ledger";
import { toMalaysiaLocalString, toSpendDate } from "@/utils/date";
import { getModel } from "@/utils/model";
import * as ai from "ai";
import { Output } from "ai";
import { wrapAISDK } from "braintrust";

const { generateText } = wrapAISDK(ai);

/**
 * Reads a receipt image into proposed `expense` rows, one per category. The
 * rows add up to the paid total and `spend_date` is in the column's format.
 * Nothing is written.
 */
export async function scanReceipt(
  { env, ledger }: { env: TAppBindings; ledger: TLedger },
  { url, mediaType }: TAiScan,
): Promise<TScanExpense[]> {
  const categories = await ledger.categories();
  const { output } = await generateText({
    model: getModel({ env, provider: "gemini" }),
    output: Output.object({ schema: scanResultSchema }),
    system: scanInstructions({
      now: toMalaysiaLocalString(new Date()),
      categories,
    }),
    messages: [
      {
        role: "user",
        content: [{ type: "file", data: new URL(url), mediaType }],
      },
    ],
  });

  const expenses = output.expenses.map((expense) => ({
    ...expense,
    spend_date: toSpendDate(expense.spend_date),
  }));
  return balanceToTotal(expenses, output.total);
}

/** Rounds to whole cents, dropping floating-point noise from sums. */
const roundCents = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Puts any gap between the records and the paid total on the largest record,
 * since models are unreliable at summing many line items. Skipped when that
 * would leave the record without a positive amount; the client's review list
 * then shows the user a sum that differs from the receipt.
 */
function balanceToTotal(
  expenses: TScanExpense[],
  total: number,
): TScanExpense[] {
  const sum = expenses.reduce((acc, expense) => acc + expense.amount, 0);
  const gap = roundCents(total - sum);
  // `scanResultSchema` guarantees at least one record.
  const largest = expenses.reduce((max, expense) =>
    expense.amount > max.amount ? expense : max,
  );
  const balancedAmount = roundCents(largest.amount + gap);
  if (gap === 0 || balancedAmount <= 0) return expenses;

  return expenses.map((expense) =>
    expense === largest ? { ...expense, amount: balancedAmount } : expense,
  );
}
