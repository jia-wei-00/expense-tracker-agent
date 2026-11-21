import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { chatAgent } from "@/services/ai/agents/chat.agent";
import { supersedeApprovals } from "@/services/ai/chat/approval.service";
import { ChatError } from "@/services/ai/chat/chat.error";
import { appendMessage, loadMessages, saveMessage } from "@/services/ai/chat/message.service";
import { runAgent } from "@/services/ai/chat/run.service";
import { createLedger } from "@/services/ledger/ledger.service";
import { consumeAiUsage } from "@/services/subscription/usage.service";
import { linkedUserId } from "@/services/telegram/link.service";
import { replyText, sendReply, withTyping } from "@/services/telegram/render.service";
import { currentSession, startSession, titleSession } from "@/services/telegram/session.service";
import type { TChatMessage, TChatTools } from "@/types/ai";
import type { TSupabaseAdminClient } from "@/types/common";
import type {
  TDmTurn,
  TTelegramDeps,
  TTelegramMessage,
  TTelegramSessionScope,
  TTurnResumeState,
} from "@/types/telegram";
import { commandArgs, shouldRotate, telegramMessageId } from "@/utils/telegram";

/**
 * `"resume"` when this message is the last one stored (an earlier attempt
 * stored it but never answered), `"duplicate"` when it was already answered.
 */
export function turnResumeState(history: TChatMessage[], messageId: string): TTurnResumeState {
  const index = history.findIndex((message) => message.id === messageId);
  if (index === -1) return "new";
  return index === history.length - 1 ? "resume" : "duplicate";
}

/**
 * The stored answer to this message when it is the session's last message:
 * an earlier attempt saved the reply but failed to send it. The inbox drops
 * Telegram redeliveries itself, so a duplicate reaching a turn is a retry.
 */
export function savedReply(history: TChatMessage[], messageId: string): TChatMessage | undefined {
  const index = history.findIndex((message) => message.id === messageId);
  const next = history[index + 1];
  const answersLast = index !== -1 && index === history.length - 2;
  return answersLast && next?.role === "assistant" ? next : undefined;
}

/** The reply for a quota refusal from `consumeAiUsage`; `undefined` for any other error. */
export function quotaCopy(error: unknown): string | undefined {
  if (!(error instanceof ChatError)) return undefined;
  if (error.status === HTTP_STATUS.PAYMENT_REQUIRED) return TELEGRAM_COPY.needsPlan;
  const quota = error.extensions?.quota;
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS && typeof quota === "number") {
    return TELEGRAM_COPY.quotaUsed(quota);
  }
  return undefined;
}

/** Spends one chat unit; returns the refusal copy instead of throwing a 402/429. */
async function chargeTurn(admin: TSupabaseAdminClient, userId: string): Promise<string | undefined> {
  try {
    await consumeAiUsage(admin, userId, "chat");
    return undefined;
  } catch (error) {
    const copy = quotaCopy(error);
    if (copy === undefined) throw error;
    return copy;
  }
}

function toUserMessage(message: TTelegramMessage, text: string): TChatMessage {
  const chatId = message.chat.id;
  return {
    id: telegramMessageId(chatId, message.message_id),
    role: "user",
    parts: [{ type: "text", text }],
    metadata: {
      telegram: {
        chatId,
        messageId: message.message_id,
        fromId: message.from?.id ?? chatId,
        fromName: message.from?.first_name ?? "",
      },
    },
  };
}

/**
 * Picks the session, charges the quota and stores the user message (spec
 * §5.3). A retry of a stored but unanswered message resumes without charging;
 * an answered one resends its saved reply if that reply is the last message,
 * else is skipped. Quota comes before any write, so a 402/429
 * leaves no session or message behind.
 */
async function prepareDmTurn(
  admin: TSupabaseAdminClient,
  scope: TTelegramSessionScope,
  { tools, userMessage, forceNew }: { tools: TChatTools; userMessage: TChatMessage; forceNew: boolean },
): Promise<TDmTurn> {
  const latest = await currentSession(admin, scope);
  const history = latest ? await loadMessages(admin, latest.id, tools) : [];
  const state = turnResumeState(history, userMessage.id);
  if (state === "duplicate") {
    const reply = savedReply(history, userMessage.id);
    return reply ? { kind: "resend", reply } : { kind: "skip" };
  }
  if (state === "resume" && latest) return { kind: "run", sessionId: latest.id, messages: history };

  const refusal = await chargeTurn(admin, scope.userId);
  if (refusal !== undefined) return { kind: "refuse", copy: refusal };

  const continues = latest !== undefined && !forceNew && !shouldRotate(latest.lastMessageAt, new Date());
  const sessionId = continues ? latest.id : await startSession(admin, scope, userMessage);
  // Only a session `/new` started empty has no history yet.
  if (continues && history.length === 0) {
    await titleSession(admin, { userId: scope.userId, sessionId, firstMessage: userMessage });
  }
  const resolved = continues ? await supersedeApprovals(admin, sessionId, history) : [];
  const saved = await appendMessage(admin, sessionId, userMessage);
  return { kind: "run", sessionId, messages: [...resolved, saved] };
}

/**
 * A private message (or `/new`) from a linked account: one agent turn,
 * answered as a reply to it. The inbox runs one update per chat at a time and
 * retries on a throw; `prepareDmTurn` makes the retry safe.
 */
export async function handleDmMessage(
  { env, admin, telegram }: TTelegramDeps,
  message: TTelegramMessage,
  { forceNew }: { forceNew: boolean },
): Promise<void> {
  const chatId = message.chat.id;
  const say = (text: string) => telegram.sendMessage({ chatId, text });
  // In a private chat the chat id is the user's id; `from` is just the explicit form.
  const telegramUserId = message.from?.id ?? chatId;
  const userId = await linkedUserId(admin, telegramUserId);
  if (userId === undefined) {
    await say(TELEGRAM_COPY.unlinked);
    return;
  }
  const scope = { userId, chatId, telegramUserId };

  const text = forceNew ? commandArgs(message.text ?? "") : message.text;
  if (forceNew && !text) {
    await startSession(admin, scope);
    await say(TELEGRAM_COPY.newConversation);
    return;
  }
  if (!text) {
    await say(TELEGRAM_COPY.unsupportedMedia);
    return;
  }

  const ledger = createLedger({ db: admin, kv: env.CACHE, userId });
  const agent = chatAgent({ env, ledger, channel: "telegram-dm" });
  const userMessage = toUserMessage(message, text);
  const turn = await prepareDmTurn(admin, scope, { tools: agent.tools, userMessage, forceNew });
  console.log(JSON.stringify({ log: "telegram_turn", chat_id: chatId, outcome: turn.kind }));
  if (turn.kind === "skip") return;
  if (turn.kind === "refuse") {
    await say(turn.copy);
    return;
  }

  const reply =
    turn.kind === "resend"
      ? turn.reply
      : await withTyping(telegram, chatId, () => runAgent({ agent, messages: turn.messages }));
  if (turn.kind === "run" && reply && reply.parts.length > 0) {
    await saveMessage(admin, turn.sessionId, reply);
  }
  await sendReply(telegram, { chatId, replyTo: message.message_id, text: replyText(reply) });
}
