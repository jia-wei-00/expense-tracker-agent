import type { Context } from "hono";
import type { ValidationTargets } from "hono";
import type { SupabaseContext } from "@supabase/server";
import type { Database } from "@/types/database";

/** User-scoped Supabase client type, parameterized with the project schema. */
export type TSupabaseClient = SupabaseContext<Database>["supabase"];

// Variables populated by the `supabaseAuth` middleware.
export type AuthVariables = {
  supabaseContext: SupabaseContext<Database>;
  accessUser: {
    email: string;
    sub: string;
  };
};

export type ValidContext<
  T,
  Target extends keyof ValidationTargets = "json" | "query",
> = Context<
  ICommonContext,
  string,
  { in: Record<Target, T>; out: Record<Target, T> }
>;

export type TContext = Context<ICommonContext>;

export interface ICommonContext {
  Bindings: AppBindings;
  Variables: AuthVariables;
}

export type AppBindings = Omit<CloudflareBindings, "VECTORIZE"> & {
  VECTORIZE: Vectorize;
};
