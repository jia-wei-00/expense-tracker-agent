import {
  CALLBACK_PREFIX,
  PHOTO_MAX_SIDE,
  SESSION_IDLE_ROTATE_MS,
  TELEGRAM_FILE_PREFIX,
  TELEGRAM_IP_RANGES,
  TELEGRAM_MESSAGE_MAX,
} from "@/constants/telegram";
import type {
  TCallbackData,
  TTelegramPhotoSize,
  TTelegramUpdate,
  TUpdateKind,
} from "@/types/telegram";

export function chatIdOf(update: TTelegramUpdate): number | undefined {
  return (
    update.message?.chat.id ??
    update.callback_query?.message?.chat.id ??
    update.my_chat_member?.chat.id
  );
}

/** The command word of a message, without any `@botname` suffix. */
function commandOf(text: string): string {
  const [word = ""] = text.trim().split(/\s+/);
  return (word.split("@")[0] ?? "").toLowerCase();
}

/** The text after the command word, e.g. `lunch 12` for `/new@bot lunch 12`. */
export function commandArgs(text: string): string {
  return text.trim().replace(/^\S+/, "").trim();
}

export function classifyUpdate(update: TTelegramUpdate): TUpdateKind {
  if (update.callback_query) return "callback";
  const message = update.message;
  if (!message || message.chat.type !== "private") return "ignore";
  switch (commandOf(message.text ?? "")) {
    case "/start":
      return "start";
    case "/help":
      return "help";
    case "/new":
      return "new";
    default:
      return "message";
  }
}

export function parseStartToken(text: string): string | undefined {
  return /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/.exec(text.trim())?.[1];
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return undefined;
    value = value * 256 + Number(part);
  }
  return value;
}

function inCidr(ip: number, cidr: string): boolean {
  const [base = "", bits = ""] = cidr.split("/");
  const baseInt = ipv4ToInt(base);
  if (baseInt === undefined) return false;
  const blockSize = 2 ** (32 - Number(bits));
  return Math.floor(ip / blockSize) === Math.floor(baseInt / blockSize);
}

export function isTelegramIp(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return value !== undefined && TELEGRAM_IP_RANGES.some((range) => inCidr(value, range));
}

export function formatCallbackData({ approve, messageId }: TCallbackData): string {
  return `${CALLBACK_PREFIX}:${approve ? 1 : 0}:${messageId}`;
}

export function parseCallbackData(raw: string): TCallbackData | undefined {
  const match = /^([a-z]+):([01]):(\d+)$/.exec(raw);
  if (match?.[1] !== CALLBACK_PREFIX) return undefined;
  return { approve: match[2] === "1", messageId: Number(match[3]) };
}

export function telegramMessageId(chatId: number, messageId: number): string {
  return `tg-${chatId}-${messageId}`;
}

/** Splits at the last newline before the limit, else hard-cuts. */
export function splitMessage(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MESSAGE_MAX) {
      parts.push(rest);
      break;
    }
    const newline = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_MAX);
    const cut = newline > 0 ? newline : TELEGRAM_MESSAGE_MAX;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(newline > 0 ? cut + 1 : cut);
  }
  return parts;
}

/** Largest photo with both sides within the limit, else the smallest one. */
export function pickPhotoSize(sizes: TTelegramPhotoSize[]): TTelegramPhotoSize | undefined {
  const area = (s: TTelegramPhotoSize) => s.width * s.height;
  const fitting = sizes.filter((s) => s.width <= PHOTO_MAX_SIDE && s.height <= PHOTO_MAX_SIDE);
  const pool = fitting.length > 0 ? fitting : sizes;
  const sorted = [...pool].sort((a, b) => area(a) - area(b));
  return fitting.length > 0 ? sorted.at(-1) : sorted[0];
}

export function toTelegramFileUrl(fileId: string): string {
  return `${TELEGRAM_FILE_PREFIX}${fileId}`;
}

export function fileIdFromUrl(url: string): string | undefined {
  return url.startsWith(TELEGRAM_FILE_PREFIX) ? url.slice(TELEGRAM_FILE_PREFIX.length) : undefined;
}

export function shouldRotate(lastMessageAt: Date | undefined, now: Date): boolean {
  return !lastMessageAt || now.getTime() - lastMessageAt.getTime() > SESSION_IDLE_ROTATE_MS;
}
