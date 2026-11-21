import { TELEGRAM_COPY, TYPING_INTERVAL_MS } from "@/constants/telegram";
import { pendingApprovals } from "@/services/ai/chat/approval.service";
import type { TChatMessage, TPendingToolPart } from "@/types/ai";
import type { TAddExpensesInput, TCategory, TDeleteExpenseInput, TUpdateExpenseInput } from "@/types/ledger";
import type { TTelegramClient } from "@/types/telegram";
import { formatCallbackData, splitMessage } from "@/utils/telegram";
import { getToolName } from "ai";

/** The text of an assistant reply, one paragraph per text part; tool parts are skipped. */
export function replyText(message: TChatMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
    .join("\n\n");
}

/** Sends `text` in Telegram-sized chunks, the first one as a reply to `replyTo`. */
export async function sendReply(
  telegram: TTelegramClient,
  { chatId, replyTo, text }: { chatId: number; replyTo: number; text: string },
): Promise<void> {
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    // Sequential on purpose: Telegram shows the chunks in send order.
    await telegram.sendMessage({ chatId, text: chunk, replyTo: index === 0 ? replyTo : undefined });
  }
}

/**
 * What a continuation added to `before`: it extends the same assistant
 * message, so the earlier parts were already sent.
 */
export function continuationOf(before: TChatMessage, after: TChatMessage): TChatMessage {
  return { ...after, parts: after.parts.slice(before.parts.length) };
}

function money(amount: number): string {
  return `RM ${amount.toFixed(2)}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function categoryName(id: number, categories: TCategory[]): string {
  return categories.find((category) => category.id === id)?.name ?? `#${id}`;
}

function addLines({ expenses }: TAddExpensesInput, categories: TCategory[]): string {
  const rows = expenses.map(
    (row) =>
      `• ${row.name} — ${money(row.amount)}${row.is_expense ? "" : " income"} (${categoryName(row.category, categories)})`,
  );
  return [`Add ${expenses.length} ${plural(expenses.length, "expense")}:`, ...rows].join("\n");
}

function updateLines({ id, ...patch }: TUpdateExpenseInput, categories: TCategory[]): string {
  const fields: string[] = [];
  if (patch.name !== undefined) fields.push(`name: ${patch.name}`);
  if (patch.amount !== undefined) fields.push(`amount: ${money(patch.amount)}`);
  if (patch.category !== undefined) fields.push(`category: ${categoryName(patch.category, categories)}`);
  if (patch.is_expense !== undefined) fields.push(`type: ${patch.is_expense ? "expense" : "income"}`);
  if (patch.spend_date !== undefined) fields.push(`date: ${patch.spend_date}`);
  return [`Update expense #${id}:`, ...fields.map((field) => `• ${field}`)].join("\n");
}

function deleteLine({ ids }: TDeleteExpenseInput): string {
  return `Delete ${plural(ids.length, "expense")} ${ids.map((id) => `#${id}`).join(", ")}`;
}

function describeCall(part: TPendingToolPart, categories: TCategory[]): string {
  if (part.type === "tool-addExpense") return addLines(part.input, categories);
  if (part.type === "tool-updateExpense") return updateLines(part.input, categories);
  if (part.type === "tool-deleteExpense") return deleteLine(part.input);
  // Only the write tools ask for approval; name any other call rather than hide it.
  return `Run ${getToolName(part)}`;
}

/**
 * The approval card for the calls of `message` waiting for a decision, built
 * from their stored input (never model text); `undefined` when none wait.
 */
export function approvalCard(message: TChatMessage, categories: TCategory[]): string | undefined {
  const pending = pendingApprovals(message);
  if (pending.length === 0) return undefined;
  return pending.map((part) => describeCall(part, categories)).join("\n\n");
}

/** Sends `text` with [Approve] [Reject] buttons for every pending call on `chat_message` row `rowId`. */
export async function sendApprovalCard(
  telegram: TTelegramClient,
  { chatId, rowId, text }: { chatId: number; rowId: number; text: string },
): Promise<void> {
  const buttons = [
    { text: TELEGRAM_COPY.approve, data: formatCallbackData({ approve: true, messageId: rowId }) },
    { text: TELEGRAM_COPY.reject, data: formatCallbackData({ approve: false, messageId: rowId }) },
  ];
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    // Sequential on purpose; the buttons go under the last chunk.
    await telegram.sendMessage({ chatId, text: chunk, buttons: index === chunks.length - 1 ? buttons : undefined });
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Telegram shows "typing" for about 5 s, so it is resent until `signal` aborts. */
async function keepTyping(telegram: TTelegramClient, chatId: number, signal: AbortSignal) {
  while (!signal.aborted) {
    // Best effort: a failed indicator must never fail the turn.
    await telegram.sendChatAction(chatId).catch((error: unknown) => {
      console.warn("telegram typing failed:", error instanceof Error ? error.message : String(error));
    });
    await sleep(TYPING_INTERVAL_MS, signal);
  }
}

/** Runs `run` while the chat shows "typing", and stops the indicator however it ends. */
export async function withTyping<T>(
  telegram: TTelegramClient,
  chatId: number,
  run: () => Promise<T>,
): Promise<T> {
  const done = new AbortController();
  const typing = keepTyping(telegram, chatId, done.signal);
  try {
    return await run();
  } finally {
    done.abort();
    await typing;
  }
}
