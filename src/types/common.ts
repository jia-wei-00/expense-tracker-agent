import type { Context } from "hono";
import type { ValidationTargets } from "hono";
import type { SupabaseContext } from "@supabase/server";
import type { Database } from "@/types/database";

/** User-scoped Supabase client type, parameterized with the project schema. */
export type TSupabaseClient = SupabaseContext<Database>["supabase"];

/** Service-role client; bypasses RLS, so callers must check ownership first. */
export type TSupabaseAdminClient = SupabaseContext<Database>["supabaseAdmin"];

// Variables populated by the `withSupabase` middleware.
export type TAuthVariables = {
  supabaseContext: SupabaseContext<Database>;
  accessUser: {
    email: string;
    sub: string;
  };
};

export type TValidContext<
  T,
  Target extends keyof ValidationTargets = "json" | "query",
> = Context<TAppEnv, string, { in: Record<Target, T>; out: Record<Target, T> }>;

export type TContext = Context<TAppEnv>;

/** Hono env for every app and middleware in this Worker. */
export type TAppEnv = {
  Bindings: TAppBindings;
  Variables: TAuthVariables;
};

export type TAppBindings = Omit<CloudflareBindings, "VECTORIZE"> & {
  VECTORIZE: Vectorize;
};
