import { describe, expect, it, vi } from "vitest";
import { HTTP_STATUS } from "@/constants/error";
import { TELEGRAM_COPY, TYPING_INTERVAL_MS } from "@/constants/telegram";
import { ChatError } from "@/services/ai/chat/chat.error";
import { replyText, withTyping } from "@/services/telegram/render.service";
import { quotaCopy, turnResumeState } from "@/services/telegram/turn.service";
import type { TChatMessage, TChatMessagePart } from "@/types/ai";
import type { TTelegramClient } from "@/types/telegram";

function userMsg(id: string): TChatMessage {
  return { id, role: "user", parts: [{ type: "text", text: "lunch 12" }] };
}

function assistantWith(parts: TChatMessagePart[], id = "msg-a"): TChatMessage {
  return { id, role: "assistant", parts };
}

const assistantMsg = (id: string) => assistantWith([text("ok")], id);

function text(value: string): TChatMessagePart {
  return { type: "text", text: value };
}

function toolPart(): TChatMessagePart {
  return {
    type: "tool-getExpense",
    toolCallId: "call-1",
    state: "input-available",
    input: { id: 1 },
  };
}

describe("turnResumeState", () => {
  it("is new, resume or duplicate by where the message id sits", () => {
    const u1 = userMsg("tg-1-10"),
      a1 = assistantMsg("msg-a"),
      u2 = userMsg("tg-1-11");
    expect(turnResumeState([u1, a1], "tg-1-11")).toBe("new");
    expect(turnResumeState([u1, a1, u2], "tg-1-11")).toBe("resume");
    expect(turnResumeState([u1, a1, u2], "tg-1-10")).toBe("duplicate");
    expect(turnResumeState([], "tg-1-10")).toBe("new");
  });
});

describe("replyText", () => {
  it("joins text parts and skips tool parts", () => {
    expect(replyText(assistantWith([text("Saved."), toolPart(), text("Anything else?")]))).toBe(
      "Saved.\n\nAnything else?",
    );
  });

  it("is empty without a reply or text", () => {
    expect(replyText(undefined)).toBe("");
    expect(replyText(assistantWith([toolPart()]))).toBe("");
  });
});

describe("quotaCopy", () => {
  it("maps 402 and 429 to their copy", () => {
    expect(quotaCopy(new ChatError(HTTP_STATUS.PAYMENT_REQUIRED, "x"))).toBe(TELEGRAM_COPY.needsPlan);
    const limit = new ChatError(HTTP_STATUS.TOO_MANY_REQUESTS, "x", undefined, { quota: 300 });
    expect(quotaCopy(limit)).toBe("You've used this month's 300 messages.");
  });

  it("leaves every other error to the caller", () => {
    expect(quotaCopy(new ChatError(HTTP_STATUS.CONFLICT, "x"))).toBeUndefined();
    expect(quotaCopy(new ChatError(HTTP_STATUS.TOO_MANY_REQUESTS, "x"))).toBeUndefined();
    expect(quotaCopy(new Error("boom"))).toBeUndefined();
  });
});

describe("withTyping", () => {
  function fakeTelegram() {
    const sendChatAction = vi.fn(() => Promise.resolve());
    const reject = () => Promise.reject(new Error("unused"));
    const telegram: TTelegramClient = {
      sendChatAction,
      sendMessage: reject,
      answerCallbackQuery: reject,
      editMessageReplyMarkup: reject,
      editMessageText: reject,
      downloadFile: reject,
    };
    return { telegram, sendChatAction };
  }

  it("types now and every interval until the run ends", async () => {
    vi.useFakeTimers();
    const { telegram, sendChatAction } = fakeTelegram();
    const run = Promise.withResolvers<string>();

    const result = withTyping(telegram, 5, () => run.promise);
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 2);
    expect(sendChatAction).toHaveBeenCalledTimes(3);

    run.resolve("done");
    await expect(result).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 2);
    expect(sendChatAction).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("stops typing when the run throws, and a typing failure never fails the run", async () => {
    const { telegram, sendChatAction } = fakeTelegram();
    sendChatAction.mockImplementation(() => Promise.reject(new Error("429")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(withTyping(telegram, 5, () => Promise.reject(new Error("model down")))).rejects.toThrow(
      "model down",
    );
    await expect(withTyping(telegram, 5, () => Promise.resolve(1))).resolves.toBe(1);
  });
});
