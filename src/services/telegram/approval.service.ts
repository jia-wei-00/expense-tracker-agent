import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { chatAgent } from "@/services/ai/agents/chat.agent";
import { applyApprovals, pendingApprovals } from "@/services/ai/chat/approval.service";
import { ChatError } from "@/services/ai/chat/chat.error";
import { loadMessages, saveMessage } from "@/services/ai/chat/message.service";
import { runAgent } from "@/services/ai/chat/run.service";
import { createLedger } from "@/services/ledger/ledger.service";
import { linkedUserId } from "@/services/telegram/link.service";
import {
  approvalCard,
  continuationOf,
  replyText,
  sendApprovalCard,
  sendReply,
  withTyping,
} from "@/services/telegram/render.service";
import type { TChatMessage } from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import type { TLedger } from "@/types/ledger";
import type {
  TCallbackOutcome,
  TCardMessage,
  TCardSession,
  TTelegramCallbackQuery,
  TTelegramClient,
  TTelegramDeps,
  TTelegramSessionScope,
} from "@/types/telegram";
import { parseCallbackData } from "@/utils/telegram";

/** True only when the card's session is this user's conversation in this Telegram chat. */
export function ownsCard(session: TCardSession | null, scope: TTelegramSessionScope): boolean {
  return (
    session !== null &&
    session.user_id === scope.userId &&
    session.telegram_chat_id === scope.chatId &&
    session.telegram_user_id === scope.telegramUserId
  );
}

/** The toast for an `applyApprovals` refusal; `undefined` for any other error. */
export function approvalErrorToast(error: unknown): string | undefined {
  if (!(error instanceof ChatError)) return undefined;
  if (error.status === HTTP_STATUS.GONE) return TELEGRAM_COPY.approvalExpired;
  if (error.status === HTTP_STATUS.CONFLICT) return TELEGRAM_COPY.approvalAnswered;
  return undefined;
}

/** The text `answerCallbackQuery` shows; a decision shows on the card instead. */
export function callbackToast(outcome: TCallbackOutcome | undefined): string | undefined {
  return outcome?.kind === "toast" || outcome?.kind === "closed" ? outcome.text : undefined;
}

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
  if (!reply || pendingApprovals(reply).length === 0) return;
  const [categories, id] = await Promise.all([
    ledger.categories(),
    rowId ?? messageRowId(admin, sessionId, reply.id),
  ]);
  const text = approvalCard(reply, categories);
  if (text !== undefined) await sendApprovalCard(telegram, { chatId, rowId: id, text });
}

/** The card's row and its session; `undefined` for an unknown id. */
async function loadCard(admin: TSupabaseAdminClient, rowId: number) {
  const { data, error } = await admin
    .from("chat_message")
    .select("ui_id, session_id, chat_session(user_id, telegram_chat_id, telegram_user_id)")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(`chat_message lookup failed: ${error.message}`);
  return data ?? undefined;
}

/** `user_entitlement.entitled_until > now()`: the service role bypasses the RLS plan gate. */
async function hasActivePlan(admin: TSupabaseAdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("user_entitlement")
    .select("user_id")
    .eq("user_id", userId)
    .gt("entitled_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`user_entitlement lookup failed: ${error.message}`);
  return data !== null;
}

/**
 * Checks a tap and applies its decision to the stored message (spec §5.4).
 * Only `ChatError` refusals become toasts; anything else throws so the inbox
 * retries, and a retry after the decision was stored is a 409, never a rerun.
 */
async function decideCallback({ env, admin }: TTelegramDeps, query: TTelegramCallbackQuery): Promise<TCallbackOutcome> {
  const data = parseCallbackData(query.data ?? "");
  if (!data || !query.message) return { kind: "silent" };
  const card: TCardMessage = { chatId: query.message.chat.id, messageId: query.message.message_id, text: query.message.text };

  const telegramUserId = query.from.id;
  const [userId, row] = await Promise.all([linkedUserId(admin, telegramUserId), loadCard(admin, data.messageId)]);
  if (userId === undefined || !row || !ownsCard(row.chat_session, { userId, chatId: card.chatId, telegramUserId })) {
    return { kind: "toast", text: TELEGRAM_COPY.notYourApproval };
  }
  if (!(await hasActivePlan(admin, userId))) return { kind: "toast", text: TELEGRAM_COPY.needsPlan };

  const ledger = createLedger({ db: admin, kv: env.CACHE, userId });
  const agent = chatAgent({ env, ledger, channel: "telegram-dm" });
  const history = await loadMessages(admin, row.session_id, agent.tools);
  // `applyApprovals` resolves the last message; a newer turn superseded this card.
  if (history.at(-1)?.id !== row.ui_id) return { kind: "closed", card, text: TELEGRAM_COPY.approvalAnswered };

  const approvals = pendingApprovals(history.at(-1)).map(({ toolCallId }) => ({
    callId: toolCallId,
    approve: data.approve,
  }));
  try {
    const messages = await applyApprovals(admin, row.session_id, history, approvals);
    if (!data.approve) return { kind: "rejected", card };
    return { kind: "approved", card, sessionId: row.session_id, messages, agent, ledger };
  } catch (error) {
    const text = approvalErrorToast(error);
    if (text === undefined) throw error;
    return { kind: "closed", card, text };
  }
}

/** Best effort: the decision is already stored, so a failed toast must not fail it. */
async function answerQuietly(telegram: TTelegramClient, queryId: string, text?: string): Promise<void> {
  await telegram.answerCallbackQuery(queryId, text).catch((error: unknown) => {
    console.warn("telegram answerCallbackQuery failed:", error instanceof Error ? error.message : String(error));
  });
}

/**
 * Appends `suffix` to the card and removes its buttons. Best effort, like the
 * toast: a cosmetic failure must not cost the continuation.
 */
async function closeCard(telegram: TTelegramClient, card: TCardMessage, suffix?: string): Promise<void> {
  try {
    if (suffix !== undefined && card.text !== undefined) {
      await telegram.editMessageText(card.chatId, card.messageId, `${card.text}\n\n${suffix}`);
    }
    await telegram.editMessageReplyMarkup(card.chatId, card.messageId);
  } catch (error) {
    console.warn("telegram card edit failed:", error instanceof Error ? error.message : String(error));
  }
}

/** Runs the approved calls (no quota: a continuation is never counted) and sends what it adds. */
async function continueApproved(
  { admin, telegram }: TTelegramDeps,
  { card, sessionId, messages, agent, ledger }: Extract<TCallbackOutcome, { kind: "approved" }>,
): Promise<void> {
  const reply = await withTyping(telegram, card.chatId, () =>
    runAgent({ agent, messages, download: telegram.downloadFile }),
  );
  const before = messages.at(-1);
  if (!reply || !before) return;
  const rowId = await saveMessage(admin, sessionId, reply);
  const added = continuationOf(before, reply);
  await sendReply(telegram, { chatId: card.chatId, replyTo: card.messageId, text: replyText(added) });
  await offerApproval({ admin, telegram }, { chatId: card.chatId, sessionId, reply: added, rowId, ledger });
}

/**
 * A tap on [Approve] / [Reject]. `answerCallbackQuery` runs exactly once per
 * attempt, as soon as the outcome is known and before the model runs.
 */
export async function handleCallback(deps: TTelegramDeps, query: TTelegramCallbackQuery): Promise<void> {
  const { telegram } = deps;
  const outcome = await decideCallback(deps, query).catch(async (error: unknown) => {
    await answerQuietly(telegram, query.id);
    throw error;
  });
  await answerQuietly(telegram, query.id, callbackToast(outcome));
  console.log(JSON.stringify({ log: "telegram_callback", chat_id: query.message?.chat.id, outcome: outcome.kind }));

  switch (outcome.kind) {
    case "silent":
    case "toast":
      return;
    case "closed":
      await closeCard(telegram, outcome.card);
      return;
    case "rejected":
      await closeCard(telegram, outcome.card, TELEGRAM_COPY.rejected);
      return;
    case "approved":
      await closeCard(telegram, outcome.card, TELEGRAM_COPY.approved);
      await continueApproved(deps, outcome);
      return;
  }
  outcome satisfies never;
}
