import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_MAX_BYTES,
  PHOTO_MEDIA_TYPE,
} from "@/constants/telegram";
import type { TChatMessage } from "@/types/ai";
import type { TDownloadFile, TTelegramMessage, TUserPart } from "@/types/telegram";
import { fileIdFromUrl, pickPhotoSize, toTelegramFileUrl } from "@/utils/telegram";

function filePart(mediaType: string, fileId: string): TUserPart {
  return { type: "file", mediaType, url: toTelegramFileUrl(fileId) };
}

/** The attachment of a message as a file part; `"unsupported"` for anything else. */
function attachmentPart({ photo, document }: TTelegramMessage): TUserPart | "unsupported" | undefined {
  const largest = photo ? pickPhotoSize(photo) : undefined;
  if (largest) return filePart(PHOTO_MEDIA_TYPE, largest.file_id);
  if (document) {
    const { mime_type: mediaType, file_id: fileId, file_size: fileSize } = document;
    // Without a size the download could be any size, so it is not accepted.
    const accepted =
      mediaType !== undefined &&
      ACCEPTED_IMAGE_TYPES.includes(mediaType) &&
      fileSize !== undefined &&
      fileSize <= IMAGE_MAX_BYTES;
    return accepted ? filePart(mediaType, fileId) : "unsupported";
  }
  return undefined;
}

/**
 * The stored user-message parts for a Telegram message: text or caption, then
 * the attachment. Voice, video, stickers and other documents are unsupported.
 */
export function userParts(message: TTelegramMessage): TUserPart[] | "unsupported" {
  const attachment = attachmentPart(message);
  if (attachment === "unsupported") return "unsupported";
  const text = message.text ?? message.caption;
  const parts: TUserPart[] = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(attachment ? [attachment] : []),
  ];
  return parts.length > 0 ? parts : "unsupported";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Replaces `telegram-file:` URLs with data URLs for the model. Each distinct
 * file is downloaded once. A failed download throws so the turn is retried.
 */
export async function resolveTelegramFiles(
  messages: TChatMessage[],
  download: TDownloadFile,
): Promise<TChatMessage[]> {
  const fileIds = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      const fileId = part.type === "file" ? fileIdFromUrl(part.url) : undefined;
      if (fileId !== undefined) fileIds.add(fileId);
    }
  }
  const entries = await Promise.all(
    [...fileIds].map(async (fileId) => {
      const { bytes, mediaType } = await download(fileId);
      return [fileId, `data:${mediaType};base64,${toBase64(bytes)}`] as const;
    }),
  );
  const dataUrls = new Map(entries);

  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      const fileId = part.type === "file" ? fileIdFromUrl(part.url) : undefined;
      const url = fileId === undefined ? undefined : dataUrls.get(fileId);
      return part.type === "file" && url !== undefined ? { ...part, url } : part;
    }),
  }));
}
