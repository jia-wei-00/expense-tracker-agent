export const getDateTimeNow = () => {
  const now = new Date();
  return now.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

/** Malaysia time is UTC+8 all year (no daylight saving). */
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** `date` as Malaysia-local ISO 8601, e.g. `2026-11-11T14:05:22+08:00`. */
export const toMalaysiaIsoString = (date: Date) =>
  `${new Date(date.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
