import { describe, expect, it } from "vitest";
import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { ChatError } from "@/services/ai/chat/chat.error";
import { approvalErrorToast, approvalState, callbackToast, ownsCard } from "@/services/telegram/approval.service";
import type { TChatMessage, TChatMessagePart } from "@/types/ai";
import type { TCardSession } from "@/types/telegram";

describe("ownsCard", () => {
  const scope = { userId: "user-1", chatId: 100, telegramUserId: 100 };
  const session: TCardSession = { user_id: "user-1", telegram_chat_id: 100, telegram_user_id: 100 };

  it("accepts only the user's session in this chat from this sender", () => {
    expect(ownsCard(session, scope)).toBe(true);
    expect(ownsCard({ ...session, user_id: "user-2" }, scope)).toBe(false);
    expect(ownsCard({ ...session, telegram_chat_id: 200 }, scope)).toBe(false);
    expect(ownsCard({ ...session, telegram_user_id: 200 }, scope)).toBe(false);
  });

  it("rejects an app session and a missing one", () => {
    expect(ownsCard({ ...session, telegram_chat_id: null, telegram_user_id: null }, scope)).toBe(false);
    expect(ownsCard(null, scope)).toBe(false);
  });
});

describe("approvalErrorToast", () => {
  it("maps 410 to expired and 409 to already answered", () => {
    expect(approvalErrorToast(new ChatError(HTTP_STATUS.GONE, "x"))).toBe(TELEGRAM_COPY.approvalExpired);
    expect(approvalErrorToast(new ChatError(HTTP_STATUS.CONFLICT, "x"))).toBe(TELEGRAM_COPY.approvalAnswered);
  });

  it("leaves every other error to the caller", () => {
    expect(approvalErrorToast(new ChatError(HTTP_STATUS.UNPROCESSABLE_ENTITY, "x"))).toBeUndefined();
    expect(approvalErrorToast(new Error("db down"))).toBeUndefined();
  });
});

describe("callbackToast", () => {
  const card = { chatId: 1, messageId: 2 };

  it("shows refusals and nothing for a decision, which edits the card instead", () => {
    expect(callbackToast({ kind: "toast", text: TELEGRAM_COPY.notYourApproval })).toBe("Not your approval.");
    expect(callbackToast({ kind: "closed", card, text: TELEGRAM_COPY.approvalAnswered })).toBe("Already answered.");
    expect(callbackToast({ kind: "rejected", card })).toBeUndefined();
    expect(callbackToast({ kind: "silent" })).toBeUndefined();
    expect(callbackToast(undefined)).toBeUndefined();
  });
});

describe("approvalState", () => {
  const input = { ids: [12] };
  const requested: TChatMessagePart = {
    type: "tool-deleteExpense",
    toolCallId: "call-1",
    state: "approval-requested",
    input,
    approval: { id: "a-1" },
  };
  const responded: TChatMessagePart = {
    type: "tool-deleteExpense",
    toolCallId: "call-2",
    state: "approval-responded",
    input,
    approval: { id: "a-2", approved: true },
  };
  const executed: TChatMessagePart = {
    type: "tool-deleteExpense",
    toolCallId: "call-3",
    state: "output-available",
    input,
    output: { ok: true, data: [{ id: 12 }] },
    approval: { id: "a-3", approved: true },
  };
  const denied: TChatMessagePart = {
    type: "tool-deleteExpense",
    toolCallId: "call-4",
    state: "output-denied",
    input,
    approval: { id: "a-4", approved: false },
  };
  const assistant = (parts: TChatMessagePart[]): TChatMessage => ({ id: "msg-a", role: "assistant", parts });

  it("is pending while any call waits for a decision", () => {
    expect(approvalState(assistant([requested, { ...requested, toolCallId: "call-5" }]))).toBe("pending");
  });

  it("is approved-unexecuted when approved calls have no output yet", () => {
    expect(approvalState(assistant([responded, { ...responded, toolCallId: "call-6" }]))).toBe("approved-unexecuted");
    expect(approvalState(assistant([executed, responded]))).toBe("approved-unexecuted");
  });

  it("is settled once every call has an output or was denied", () => {
    expect(approvalState(assistant([executed, denied]))).toBe("settled");
    expect(approvalState(assistant([{ type: "text", text: "hi" }]))).toBe("settled");
    expect(approvalState(undefined)).toBe("settled");
  });
});
