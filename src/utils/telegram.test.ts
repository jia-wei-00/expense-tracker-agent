import { describe, expect, it } from "vitest";
import {
  chatIdOf,
  classifyUpdate,
  commandArgs,
  fileIdFromUrl,
  formatCallbackData,
  parseCallbackData,
  parseStartToken,
  pickPhotoSize,
  isTelegramIp,
  shouldRotate,
  splitMessage,
  telegramMessageId,
  toTelegramFileUrl,
} from "@/utils/telegram";
import type { TTelegramPhotoSize, TTelegramUpdate } from "@/types/telegram";

const user = { id: 7, is_bot: false, first_name: "Wei" };

function privateText(text: string): TTelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 10, chat: { id: 7, type: "private" }, from: user, text },
  };
}

function groupText(text: string): TTelegramUpdate {
  return {
    update_id: 2,
    message: { message_id: 11, chat: { id: -100, type: "supergroup" }, from: user, text },
  };
}

function callback(data: string): TTelegramUpdate {
  return {
    update_id: 3,
    callback_query: {
      id: "cb1",
      from: user,
      data,
      message: { message_id: 12, chat: { id: 7, type: "private" } },
    },
  };
}

function myChatMember(status: string): TTelegramUpdate {
  return {
    update_id: 4,
    my_chat_member: { chat: { id: 7, type: "private" }, new_chat_member: { status } },
  };
}

function size(width: number, height: number): TTelegramPhotoSize {
  return { file_id: `f${width}`, width, height };
}

describe("classifyUpdate", () => {
  it("routes private /start, /help, /new, text and callbacks", () => {
    expect(classifyUpdate(privateText("/start abc"))).toBe("start");
    expect(classifyUpdate(privateText("/help"))).toBe("help");
    expect(classifyUpdate(privateText("/new"))).toBe("new");
    expect(classifyUpdate(privateText("lunch 12"))).toBe("message");
    expect(classifyUpdate(callback("apv:1:42"))).toBe("callback");
  });
  it("ignores group chats and membership updates in slice 1", () => {
    expect(classifyUpdate(groupText("@bot lunch 12"))).toBe("ignore");
    expect(classifyUpdate(myChatMember("kicked"))).toBe("ignore");
  });
});
it("chatIdOf", () => {
  expect(chatIdOf(privateText("hi"))).toBe(7);
  expect(chatIdOf(callback("apv:1:1"))).toBe(7);
  expect(chatIdOf(myChatMember("kicked"))).toBe(7);
});
it("parseStartToken", () => {
  expect(parseStartToken("/start abc_DEF-123")).toBe("abc_DEF-123");
  expect(parseStartToken("/start")).toBeUndefined();
});
it("isTelegramIp", () => {
  expect(isTelegramIp("149.154.167.220")).toBe(true);
  expect(isTelegramIp("91.108.6.1")).toBe(true);
  expect(isTelegramIp("8.8.8.8")).toBe(false);
  expect(isTelegramIp("not-an-ip")).toBe(false);
});
it("callback data round-trips and rejects junk", () => {
  expect(formatCallbackData({ approve: true, messageId: 881 })).toBe("apv:1:881");
  expect(parseCallbackData("apv:0:881")).toEqual({ approve: false, messageId: 881 });
  expect(parseCallbackData("apv:2:881")).toBeUndefined();
  expect(parseCallbackData("xyz:1:881")).toBeUndefined();
  expect(
    formatCallbackData({ approve: true, messageId: Number.MAX_SAFE_INTEGER }).length,
  ).toBeLessThanOrEqual(64);
});
it("telegramMessageId", () => {
  expect(telegramMessageId(12345, 67)).toBe("tg-12345-67");
});
it("splitMessage", () => {
  expect(splitMessage("")).toEqual([]);
  expect(splitMessage("hi")).toEqual(["hi"]);
  const parts = splitMessage("a".repeat(4096 * 2 + 10));
  expect(parts).toHaveLength(3);
  expect(parts.every((p) => p.length <= 4096)).toBe(true);
});
it("pickPhotoSize", () => {
  expect(
    pickPhotoSize([size(90, 90), size(800, 600), size(1280, 960), size(2560, 1920)])?.width,
  ).toBe(1280);
  expect(pickPhotoSize([size(2000, 1500), size(4000, 3000)])?.width).toBe(2000);
  expect(pickPhotoSize([])).toBeUndefined();
});
it("telegram file urls", () => {
  expect(toTelegramFileUrl("AgAC")).toBe("telegram-file:AgAC");
  expect(fileIdFromUrl("telegram-file:AgAC")).toBe("AgAC");
  expect(fileIdFromUrl("https://x/y.jpg")).toBeUndefined();
});
it("shouldRotate", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  expect(shouldRotate(undefined, now)).toBe(true);
  expect(shouldRotate(new Date("2026-11-21T09:00:01Z"), now)).toBe(false);
  expect(shouldRotate(new Date("2026-11-21T08:59:59Z"), now)).toBe(true);
});
it("commandArgs drops the command word and its @bot suffix", () => {
  expect(commandArgs("/new")).toBe("");
  expect(commandArgs("/new   ")).toBe("");
  expect(commandArgs("/new@ExpenseBot lunch 12")).toBe("lunch 12");
  expect(commandArgs("/new  lunch 12\ndinner 30")).toBe("lunch 12\ndinner 30");
});
