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
  TApprovalState,
  TCallbackOutcome,
  TCardMessage,
  TCardSession,
  TTelegramCallbackQuery,
  TTelegramClient,
  TTelegramDeps,
  TTelegramSessionScope,
} from "@/types/telegram";
import { parseCallbackData } from "@/utils/telegram";
import { isToolUIPart } from "ai";

/** True only when the card's session is this user's conversation in this Telegram chat. */
export function ownsCard(session: TCardSession | null, scope: TTelegramSessionScope): boolean {
  return (
    session !== null &&
    session.user_id === scope.userId &&
    session.telegram_chat_id === scope.chatId &&
    session.telegram_user_id === scope.telegramUserId
  );
}

/**
 * Where the decision on a card's message stands: calls still waiting
 * (`pending`), approved but not yet run (`approved-unexecuted`: the
 * continuation failed after the decision was stored), or done (`settled`).
 */
export function approvalState(message: TChatMessage | undefined): TApprovalState {
  if (pendingApprovals(message).length > 0) return "pending";
  const unexecuted =
    message?.role === "assistant" &&
    message.parts.some((part) => isToolUIPart(part) && part.state === "approval-responded" && part.approval.approved);
  return unexecuted ? "approved-unexecuted" : "settled";
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
 * Stores the tap's decision for every pending call of the last message
 * (single-use, 10-minute expiry); a 409/410 becomes a toast.
 */
async function applyDecision(
  admin: TSupabaseAdminClient,
  approve: boolean,
  { card, sessionId, messages: history, agent, ledger }: Extract<TCallbackOutcome, { kind: "approved" }>,
): Promise<TCallbackOutcome> {
  const approvals = pendingApprovals(history.at(-1)).map(({ toolCallId }) => ({ callId: toolCallId, approve }));
  try {
    const messages = await applyApprovals(admin, sessionId, history, approvals);
    return approve ? { kind: "approved", card, sessionId, messages, agent, ledger } : { kind: "rejected", card };
  } catch (error) {
    const text = approvalErrorToast(error);
    if (text === undefined) throw error;
    return { kind: "closed", card, text };
  }
}

/**
 * Checks a tap and applies its decision to the stored message (spec §5.4).
 * Only `ChatError` refusals become toasts; anything else throws so the inbox
 * retries.
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

  const sessionId = row.session_id;
  // The approved outcome as the history stands; `applyDecision` resolves it first.
  const resume = { kind: "approved", card, sessionId, messages: history, agent, ledger } as const;
  // A retry whose approval was stored but whose continuation failed finishes
  // it, so the approved write never runs late at the start of the next turn.
  // Residual risk: if the tool's write succeeded and only `saveMessage`
  // failed, this reruns the tool (a possible duplicate row), the same window
  // as the app's `onEnd` save. A Reject tap never reaches this state.
  if (approvalState(history.at(-1)) === "approved-unexecuted") {
    return data.approve ? resume : { kind: "closed", card, text: TELEGRAM_COPY.approvalAnswered };
  }
  return applyDecision(admin, data.approve, resume);
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
    // A retried edit is a no-op ("not modified" is ignored); never append twice.
    if (suffix !== undefined && card.text !== undefined && !card.text.endsWith(`\n\n${suffix}`)) {
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
