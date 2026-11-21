import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTelegramClient } from "@/libs/telegram";
import type { TFakeFetchCall } from "@/types/telegram";

const bodySchema = z.looseObject({});

function fakeFetch(responses: Array<object | Uint8Array>) {
  const calls: TFakeFetchCall[] = [];
  const queue = [...responses];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body });
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("no response queued"));
    }
    const payload = next instanceof Uint8Array ? next : JSON.stringify(next);
    return Promise.resolve(new Response(payload));
  };
  return { fetch, calls };
}

describe("createTelegramClient", () => {
  it("sendMessage posts JSON and returns the message id", async () => {
    const { fetch, calls } = fakeFetch([{ ok: true, result: { message_id: 9 } }]);
    const tg = createTelegramClient({ token: "T0K", fetch });
    await expect(
      tg.sendMessage({ chatId: 5, text: "hi", buttons: [{ text: "Approve", data: "apv:1:2" }] }),
    ).resolves.toEqual({ messageId: 9 });
    expect(calls[0]?.url).toBe("https://api.telegram.org/botT0K/sendMessage");
    expect(bodySchema.parse(JSON.parse(String(calls[0]?.body)))).toMatchObject({
      chat_id: 5,
      text: "hi",
      reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: "apv:1:2" }]] },
    });
  });

  it("errors never contain the token", async () => {
    const { fetch } = fakeFetch([{ ok: false, description: "Bad Request" }]);
    const tg = createTelegramClient({ token: "T0K", fetch });
    await expect(tg.sendChatAction(5)).rejects.toThrow(/^telegram sendChatAction: Bad Request$/);
  });

});

describe("createTelegramClient edits and downloads", () => {
  it("editMessageReplyMarkup swallows 'message is not modified'", async () => {
    const { fetch } = fakeFetch([
      { ok: false, description: "Bad Request: message is not modified" },
    ]);
    const tg = createTelegramClient({ token: "T0K", fetch });
    await expect(tg.editMessageReplyMarkup(5, 9)).resolves.toBeUndefined();
  });

  it("editMessageReplyMarkup rethrows other errors", async () => {
    const { fetch } = fakeFetch([{ ok: false, description: "Bad Request: chat not found" }]);
    const tg = createTelegramClient({ token: "T0K", fetch });
    await expect(tg.editMessageReplyMarkup(5, 9)).rejects.toThrow(
      "telegram editMessageReplyMarkup: Bad Request: chat not found",
    );
  });

  it("downloadFile resolves bytes and media type", async () => {
    const { fetch, calls } = fakeFetch([
      { ok: true, result: { file_path: "photos/a.jpg" } },
      new Uint8Array([1, 2]),
    ]);
    const file = await createTelegramClient({ token: "T0K", fetch }).downloadFile("AgAC");
    expect([...file.bytes]).toEqual([1, 2]);
    expect(file.mediaType).toBe("image/jpeg");
    expect(calls[1]?.url).toBe("https://api.telegram.org/file/botT0K/photos/a.jpg");
    expect(Object.keys(file).sort()).toEqual(["bytes", "mediaType"]);
  });

  it("downloadFile defaults unknown extensions to octet-stream", async () => {
    const { fetch } = fakeFetch([
      { ok: true, result: { file_path: "docs/a.bin" } },
      new Uint8Array([3]),
    ]);
    const file = await createTelegramClient({ token: "T0K", fetch }).downloadFile("x");
    expect(file.mediaType).toBe("application/octet-stream");
  });
});
