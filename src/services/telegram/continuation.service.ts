import { unexecutedApprovals } from "@/services/ai/chat/approval.service";
import { saveMessage } from "@/services/ai/chat/message.service";
import { runAgent } from "@/services/ai/chat/run.service";
import { offerApproval } from "@/services/telegram/card.service";
import { resolveTelegramFiles } from "@/services/telegram/media.service";
import { continuationOf, replyOrFallback, sendReply, withTyping } from "@/services/telegram/render.service";
import type { TChatMessage, TChatMessagePart, TReplySnapshotHandler } from "@/types/ai";
import type { TLedger } from "@/types/ledger";
import type { TCallbackOutcome, TCardMessage, TTelegramDeps } from "@/types/telegram";
import { callsTag } from "@/utils/telegram";
import { isToolUIPart } from "ai";

/** True when the call has a result from running (not a denial). */
function hasRun(part: TChatMessagePart): boolean {
  return isToolUIPart(part) && (part.state === "output-available" || part.state === "output-error");
}

function hasRunCall(message: TChatMessage, toolCallId: string): boolean {
  return message.parts.some((part) => isToolUIPart(part) && part.toolCallId === toolCallId && hasRun(part));
}

/**
 * A snapshot handler that calls `save` once, with the first snapshot in which
 * every call approved in `before` has run. The write is then on record before
 * the model answers, so a failure while it answers is retried as a resend,
 * never as a second write.
 */
export function saveOnceRun(before: TChatMessage, save: TReplySnapshotHandler): TReplySnapshotHandler {
  const callIds = unexecutedApprovals(before).map(({ toolCallId }) => toolCallId);
  let saved = false;
  return async (snapshot) => {
    if (saved || callIds.length === 0) return;
    if (!callIds.every((toolCallId) => hasRunCall(snapshot, toolCallId))) return;
    saved = true;
    await save(snapshot);
  };
}

/** The tool calls of `parts` that went through an approval. */
function approvalCalls(parts: TChatMessagePart[]) {
  return parts.filter(isToolUIPart).filter((part) => part.approval !== undefined);
}

/** `parts` split at each `step-start`, each step with the index the next one starts at. */
function steps(parts: TChatMessagePart[]): Array<{ parts: TChatMessagePart[]; next: number }> {
  const result: Array<{ parts: TChatMessagePart[]; next: number }> = [];
  let start = 0;
  for (const [index, part] of parts.entries()) {
    if (part.type !== "step-start") continue;
    result.push({ parts: parts.slice(start, index), next: index });
    start = index + 1;
  }
  result.push({ parts: parts.slice(start), next: parts.length });
  return result;
}

/**
 * What the continuation of the card tagged `tag` added to `message`: the
 * parts after the step whose approval calls the card showed (a run stops at
 * the step that asks, so a card's calls share one step). `undefined` unless
 * the card was approved and all its calls ran.
 */
export function cardContinuation(message: TChatMessage, tag: string): TChatMessage | undefined {
  const step = steps(message.parts).find(({ parts }) => {
    const calls = approvalCalls(parts);
    return calls.length > 0 && callsTag(calls.map(({ toolCallId }) => toolCallId)) === tag;
  });
  if (!step) return undefined;
  const ran = approvalCalls(step.parts).every((part) => part.approval?.approved === true && hasRun(part));
  return ran ? { ...message, parts: message.parts.slice(step.next) } : undefined;
}

/** Sends what a continuation added: its text (or the fallback) and any new card. */
async function deliverContinuation(
  { admin, telegram }: Pick<TTelegramDeps, "admin" | "telegram">,
  { card, sessionId, added, rowId, ledger }: {
    card: TCardMessage;
    sessionId: string;
    added: TChatMessage;
    rowId?: number;
    ledger: TLedger;
  },
): Promise<void> {
  await sendReply(telegram, { chatId: card.chatId, replyTo: card.messageId, text: replyOrFallback(added) });
  await offerApproval({ admin, telegram }, { chatId: card.chatId, sessionId, reply: added, rowId, ledger });
}

/**
 * Runs the approved calls (no quota: a continuation is never counted) and
 * sends what it adds. The message is stored as soon as the calls have run
 * (`saveOnceRun`), so a retry after a failed answer finds them settled and
 * resends instead of writing again. Residual risk: a write that succeeded but
 * whose result was never stored (that save failed, or the isolate died in
 * between) runs again on retry, a possible duplicate row.
 */
export async function continueApproved(
  { admin, telegram }: Pick<TTelegramDeps, "admin" | "telegram">,
  { card, sessionId, messages, agent, ledger }: Extract<TCallbackOutcome, { kind: "approved" }>,
): Promise<void> {
  const before = messages.at(-1);
  if (!before) throw new Error("approval continuation has no message");
  const save: TReplySnapshotHandler = async (message) => {
    await saveMessage(admin, sessionId, message);
  };
  const reply = await withTyping(telegram, card.chatId, () =>
    runAgent({
      agent,
      messages,
      prepareModelInput: (history) => resolveTelegramFiles(history, telegram.downloadFile),
      onSnapshot: saveOnceRun(before, save),
    }),
  );
  // Thrown so the inbox retries; the retry resumes from `approved-unexecuted`.
  if (!reply) throw new Error("approval continuation produced no message");
  const rowId = await saveMessage(admin, sessionId, reply);
  await deliverContinuation({ admin, telegram }, { card, sessionId, added: continuationOf(before, reply), rowId, ledger });
}

/**
 * A retried approval whose continuation was stored but maybe not delivered:
 * sends its text (or the fallback, when the answer was never generated) and
 * re-offers any newer card.
 */
export async function resendContinuation(
  deps: Pick<TTelegramDeps, "admin" | "telegram">,
  { card, sessionId, continuation, ledger }: Extract<TCallbackOutcome, { kind: "resend" }>,
): Promise<void> {
  await deliverContinuation(deps, { card, sessionId, added: continuation, ledger });
}
