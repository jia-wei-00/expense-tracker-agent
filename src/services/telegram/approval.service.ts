import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { chatAgent } from "@/services/ai/agents/chat.agent";
import { applyApprovals, pendingApprovals } from "@/services/ai/chat/approval.service";
import { ChatError } from "@/services/ai/chat/chat.error";
import { loadMessages } from "@/services/ai/chat/message.service";
import { createLedger } from "@/services/ledger/ledger.service";
import { bestEffort, closeCard } from "@/services/telegram/card.service";
import { cardContinuation, continueApproved, resendContinuation } from "@/services/telegram/continuation.service";
import { linkedUserId } from "@/services/telegram/link.service";
import { approvalState, cardTag } from "@/services/telegram/render.service";
import type { TSupabaseAdminClient } from "@/types/common";
import type {
  TCallbackData,
  TCallbackOutcome,
  TCardMessage,
  TCardSession,
  TTelegramCallbackQuery,
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
 * What a tap does to the card's message as stored. `applyApprovals` resolves
 * the last message, so a newer turn means the card was superseded; a tag
 * mismatch is a stale button (the message now waits on other calls) or calls
 * already settled.
 */
async function decideOnHistory(
  admin: TSupabaseAdminClient,
  { data, uiId, retry, resume }: {
    data: TCallbackData;
    uiId: string;
    retry: boolean;
    resume: Extract<TCallbackOutcome, { kind: "approved" }>;
  },
): Promise<TCallbackOutcome> {
  const { card, messages, sessionId, ledger } = resume;
  const answered = { kind: "closed", card, text: TELEGRAM_COPY.approvalAnswered } as const;
  const last = messages.at(-1);
  if (!last || last.id !== uiId) return answered;

  if (cardTag(last) === data.tag) {
    // A retry whose approval was stored but whose calls never ran finishes
    // them (see `continueApproved` for when a write may repeat). A Reject tap
    // never reaches this state.
    if (approvalState(last) === "approved-unexecuted") return data.approve ? resume : answered;
    return applyDecision(admin, data.approve, resume);
  }
  // A retry of an approval whose calls ran: the failed attempt stored the
  // continuation but may not have sent it. A first attempt is a stale tap.
  const continuation = retry && data.approve ? cardContinuation(last, data.tag) : undefined;
  return continuation ? { kind: "resend", card, sessionId, continuation, ledger } : answered;
}

/**
 * Checks a tap and applies its decision to the stored message (spec §5.4).
 * Only `ChatError` refusals become toasts; anything else throws so the inbox
 * retries.
 */
async function decideCallback(
  { env, admin }: TTelegramDeps,
  query: TTelegramCallbackQuery,
  retry: boolean,
): Promise<TCallbackOutcome> {
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
  const sessionId = row.session_id;
  const messages = await loadMessages(admin, sessionId, agent.tools);
  // The approved outcome as the history stands; `applyDecision` resolves it first.
  const resume = { kind: "approved", card, sessionId, messages, agent, ledger } as const;
  return decideOnHistory(admin, { data, uiId: row.ui_id, retry, resume });
}

/**
 * A tap on [Approve] / [Reject]. `answerCallbackQuery` runs exactly once per
 * attempt, as soon as the outcome is known and before the model runs.
 * `retry` is true when the inbox runs this update again after a failure.
 */
export async function handleCallback(
  deps: TTelegramDeps,
  query: TTelegramCallbackQuery,
  { retry }: { retry: boolean },
): Promise<void> {
  const { telegram } = deps;
  const answer = (text?: string) => bestEffort("answerCallbackQuery", () => telegram.answerCallbackQuery(query.id, text));
  const outcome = await decideCallback(deps, query, retry).catch(async (error: unknown) => {
    await answer();
    throw error;
  });
  await answer(callbackToast(outcome));
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
    case "resend":
      await closeCard(telegram, outcome.card, TELEGRAM_COPY.approved);
      await resendContinuation(deps, outcome);
      return;
  }
  outcome satisfies never;
}
