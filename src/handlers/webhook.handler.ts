import { errorResponse, successResponse } from "@/libs/response";
import { revenuecatEnvironmentSchema } from "@/schemas/revenuecat.schema";
import { handleRevenuecatEvent } from "@/services/subscription/revenuecat.service";
import type { TValidContext } from "@/types/common";
import type { TRevenuecatWebhook } from "@/types/subscription";

/**
 * `POST /webhooks/revenuecat`. Every handled or consciously ignored event is
 * acknowledged with 200 so RevenueCat does not retry it; only an unexpected
 * failure returns 500, which RevenueCat retries with backoff.
 */
export async function revenuecatWebhook(c: TValidContext<TRevenuecatWebhook>) {
  const { event } = c.req.valid("json");
  const { app_user_id: appUserId, environment } = event;

  try {
    const outcome = await handleRevenuecatEvent(
      c.var.supabaseContext.supabaseAdmin,
      event,
      revenuecatEnvironmentSchema.parse(c.env.REVENUECAT_ENVIRONMENT),
    );
    console.log(
      JSON.stringify({ log: "rc_webhook", id: event.id, type: event.type, appUserId, environment, outcome }),
    );
    return successResponse(c, { data: { outcome } });
  } catch (error) {
    console.error(`revenuecatWebhook failed (${event.type} ${event.id}):`, error);
    return errorResponse(c);
  }
}
