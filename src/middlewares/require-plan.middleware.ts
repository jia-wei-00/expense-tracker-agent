import { createMiddleware } from "hono/factory";
import { HTTP_STATUS } from "@/constants/error";
import { PLAN_LABELS } from "@/constants/subscription";
import { errorResponse } from "@/libs/response";
import type { TAppEnv } from "@/types/common";
import type { TRequirePlanOptions } from "@/types/subscription";

/**
 * Lets the request through only when the user holds one of `plans` and it is
 * still active. Must run after `withSupabase({ auth: "user" })`.
 *
 * The whole check happens in SQL against the `user_entitlement` view: the tier
 * must be one of `plans` and `entitled_until` must be in the future, so a
 * lapsed Pro user is rejected even though `user_profile.tier` still says
 * `pro`. No row means free, which is also rejected with 402.
 *
 * @example
 * ai.post("/export", requirePlan({ plans: ["pro"] }), exportHandler);
 * ai.use("/premium/*", requirePlan({ plans: ["plus", "pro"] }));
 */
export function requirePlan({ plans }: TRequirePlanOptions) {
  const planNames = plans.map((plan) => PLAN_LABELS[plan]).join(" or ");

  return createMiddleware<TAppEnv>(async (c, next) => {
    const { supabase, userClaims } = c.var.supabaseContext;
    if (!userClaims) {
      return errorResponse(c, {
        status: HTTP_STATUS.UNAUTHORIZED,
        title: "Not authenticated",
      });
    }

    const { data: entitlement, error } = await supabase
      .from("user_entitlement")
      .select("user_id")
      .eq("user_id", userClaims.id)
      .in("tier", [...plans])
      .gt("entitled_until", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!entitlement) {
      return errorResponse(c, {
        status: HTTP_STATUS.PAYMENT_REQUIRED,
        title: "Subscription required",
        detail: `This feature needs an active ${planNames} plan.`,
      });
    }
    await next();
  });
}
