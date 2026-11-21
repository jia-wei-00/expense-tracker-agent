import { describe, expect, it, vi } from "vitest";
import { resolveTelegramFiles, userParts } from "@/services/telegram/media.service";
import type { TChatMessage } from "@/types/ai";
import type { TTelegramMessage } from "@/types/telegram";

const MB = 1024 * 1024;
const base = { message_id: 1, chat: { id: 5, type: "private" } };

function size(width: number, height: number, fileId: string) {
  return { file_id: fileId, width, height };
}

function photoMsg(caption: string, photo: ReturnType<typeof size>[]): TTelegramMessage {
  return { ...base, caption, photo };
}

function documentMsg(mimeType: string | undefined, fileSize: number): TTelegramMessage {
  return { ...base, document: { file_id: "D", mime_type: mimeType, file_size: fileSize } };
}

function voiceMsg(): TTelegramMessage {
  return { ...base, voice: { file_id: "V" } };
}

function userWithFiles(urls: string[]): TChatMessage {
  return {
    id: "tg-5-1",
    role: "user",
    parts: urls.map((url) => ({ type: "file", mediaType: "image/jpeg", url })),
  };
}

function fileUrls(messages: TChatMessage[]): string[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "file" ? [part.url] : [])),
  );
}

describe("userParts", () => {
  it("maps photo + caption and rejects voice and bad documents", () => {
    expect(userParts(photoMsg("lunch", [size(800, 600, "A"), size(1280, 960, "B")]))).toEqual([
      { type: "text", text: "lunch" },
      { type: "file", mediaType: "image/jpeg", url: "telegram-file:B" },
    ]);
    expect(userParts(voiceMsg())).toBe("unsupported");
    expect(userParts(documentMsg("application/pdf", 1000))).toBe("unsupported");
    expect(userParts(documentMsg("image/png", 9 * MB))).toBe("unsupported");
    expect(userParts(documentMsg(undefined, 1000))).toBe("unsupported");
  });

  it("maps text, and an image document with its own mime type", () => {
    expect(userParts({ ...base, text: "hi" })).toEqual([{ type: "text", text: "hi" }]);
    expect(userParts(documentMsg("image/png", 1000))).toEqual([
      { type: "file", mediaType: "image/png", url: "telegram-file:D" },
    ]);
  });
});

describe("resolveTelegramFiles", () => {
  it("inlines bytes once per file id and keeps other urls", async () => {
    const download = vi.fn(() => Promise.resolve({ bytes: new Uint8Array([255]), mediaType: "image/jpeg" }));
    const out = await resolveTelegramFiles(
      [userWithFiles(["telegram-file:B", "telegram-file:B", "https://x/y.png"])],
      download,
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(fileUrls(out)).toEqual([
      "data:image/jpeg;base64,/w==",
      "data:image/jpeg;base64,/w==",
      "https://x/y.png",
    ]);
  });

  it("rejects when a download fails", async () => {
    const download = vi.fn(() => Promise.reject(new Error("boom")));
    await expect(resolveTelegramFiles([userWithFiles(["telegram-file:B"])], download)).rejects.toThrow("boom");
  });
});
