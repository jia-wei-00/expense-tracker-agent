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
