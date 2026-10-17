import type { Json } from "@/types/database";

/**
 * Converts a value to the `Json` shape Supabase expects for `jsonb` columns.
 *
 * AI SDK message types contain `unknown`-typed fields (tool/provider metadata)
 * that TypeScript cannot prove are JSON. The round-trip makes it true at
 * runtime (dropping `undefined` and non-JSON values) rather than asserting it.
 */
export const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value));
