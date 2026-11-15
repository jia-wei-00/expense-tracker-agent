import { z } from "zod";
import type { Json } from "@/types/database";

/**
 * Converts a value to the `Json` shape Supabase expects for `jsonb` columns.
 *
 * AI SDK message types contain `unknown`-typed fields (tool/provider metadata)
 * that TypeScript cannot prove are JSON. The round-trip makes it true at
 * runtime (dropping `undefined` and non-JSON values); the parse turns the
 * untyped result into `Json` instead of asserting it.
 */
export const toJson = (value: unknown): Json =>
  z.json().parse(JSON.parse(JSON.stringify(value)));

/**
 * `value` with every object's keys in sorted order, at every depth. Postgres
 * `jsonb` does not keep key order, so a value read back from a `jsonb` column
 * only serializes to the same text as the original once both are sorted.
 */
export const sortKeys = (value: Json): Json => {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key];
        return [key, item === undefined ? item : sortKeys(item)];
      }),
  );
};
