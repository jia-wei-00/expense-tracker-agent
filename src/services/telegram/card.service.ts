import { pendingApprovals } from "@/services/ai/chat/approval.service";
import {
  approvalCard,
  cardTag,
  decidedCardText,
  sendApprovalCard,
} from "@/services/telegram/render.service";
import type { TChatMessage } from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import type { TLedger } from "@/types/ledger";
import type { TCardMessage, TTelegramClient, TTelegramDeps } from "@/types/telegram";

/** The `chat_message.id` of a stored message, for its card's buttons. */
async function messageRowId(admin: TSupabaseAdminClient, sessionId: string, uiId: string): Promise<number> {
  const { data, error } = await admin
    .from("chat_message")
    .select("id")
    .eq("session_id", sessionId)
    .eq("ui_id", uiId)
    .single();
  if (error) throw new Error(`chat_message id lookup failed: ${error.message}`);
  return data.id;
}

/**
 * Sends the approval card for `reply` when it waits on a decision. `sessionId`
 * must come from a session already checked to be the user's.
 */
export async function offerApproval(
  { admin, telegram }: Pick<TTelegramDeps, "admin" | "telegram">,
  { chatId, sessionId, reply, rowId, ledger }: {
    chatId: number;
    sessionId: string;
    reply: TChatMessage | undefined;
    rowId?: number;
    ledger: TLedger;
  },
): Promise<void> {
  const tag = cardTag(reply);
  if (!reply || pendingApprovals(reply).length === 0 || tag === undefined) return;
  const [categories, id] = await Promise.all([
    ledger.categories(),
    rowId ?? messageRowId(admin, sessionId, reply.id),
  ]);
  const text = approvalCard(reply, categories);
  if (text !== undefined) await sendApprovalCard(telegram, { chatId, rowId: id, tag, text });
}

/**
 * Best effort for the Telegram calls around a decision: it is already stored,
 * so a failed toast or card edit must not fail the update (a retry would see
 * a 409) or cost the continuation.
 */
export async function bestEffort(label: string, call: () => Promise<void>): Promise<void> {
  await call().catch((error: unknown) => {
    console.warn(`telegram ${label} failed:`, error instanceof Error ? error.message : String(error));
  });
}

/**
 * Appends `suffix` to the card (unless it would not fit) and removes its
 * buttons. The removal is attempted on its own: a failed text edit must never
 * leave a live button behind. A retried edit is a no-op ("not modified").
 */
export async function closeCard(telegram: TTelegramClient, card: TCardMessage, suffix?: string): Promise<void> {
  const text = suffix === undefined ? undefined : decidedCardText(card.text, suffix);
  if (text !== undefined) {
    await bestEffort("card text edit", () => telegram.editMessageText(card.chatId, card.messageId, text));
  }
  await bestEffort("card buttons removal", () => telegram.editMessageReplyMarkup(card.chatId, card.messageId));
}
