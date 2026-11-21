import { describe, expect, it } from "vitest";
import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { ChatError } from "@/services/ai/chat/chat.error";
import { approvalErrorToast, callbackToast, ownsCard } from "@/services/telegram/approval.service";
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
