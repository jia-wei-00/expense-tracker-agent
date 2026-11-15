/** Malaysia time is UTC+8 all year (no daylight saving). */
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Ends in `Z` or a `±hh:mm` / `±hhmm` UTC offset. */
const UTC_OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * `date` as Malaysia local time without an offset, e.g. `2026-11-11T14:05:22`:
 * the format of the `expense.spend_date` column (`timestamp without time zone`).
 */
export const toMalaysiaLocalString = (date: Date) =>
  new Date(date.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 19);

/** `date` as Malaysia-local ISO 8601, e.g. `2026-11-11T14:05:22+08:00`. */
export const toMalaysiaIsoString = (date: Date) =>
  `${toMalaysiaLocalString(date)}+08:00`;

/**
 * An ISO 8601 datetime in the `expense.spend_date` format. A value without an
 * offset is already Malaysia local time; one with `Z` or an offset is
 * converted, since the column would otherwise drop the offset silently.
 */
export const toSpendDate = (value: string) =>
  toMalaysiaLocalString(
    new Date(UTC_OFFSET_SUFFIX.test(value) ? value : `${value}+08:00`),
  );
