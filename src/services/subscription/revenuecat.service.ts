import { z } from "zod";
import { PG_ERROR_CODE } from "@/constants/error";
import { REVENUECAT_EVENT_FLAGS } from "@/constants/subscription";
import {
  lifecycleEventSchema,
  lifecycleEventTypeSchema,
  rpcOutcomeSchema,
  transferEventSchema,
} from "@/schemas/revenuecat.schema";
import type { TSupabaseAdminClient } from "@/types/common";
import type { Json } from "@/types/database";
import type {
  TLifecycleEvent,
  TRevenuecatEnvironment,
  TRevenuecatEvent,
  TSubscriptionPatch,
  TTier,
  TTransferEvent,
  TWebhookOutcome,
} from "@/types/subscription";
import { toJson } from "@/utils/json";

const uuidSchema = z.uuid();

const isUuid = (id: string) => uuidSchema.safeParse(id).success;

const toIso = (ms: number) => new Date(ms).toISOString();

/** `pro` wins over `plus`; no known entitlement keeps the stored tier. */
function tierFromEntitlements(
  ids: string[] | null | undefined,
): TTier | undefined {
  if (ids?.includes("pro")) return "pro";
  if (ids?.includes("plus")) return "plus";
  return undefined;
}

/** The Supabase user id RevenueCat was given at login; anonymous ids never match. */
function resolveUserId(event: TLifecycleEvent): string | undefined {
  return [
    event.app_user_id,
    event.original_app_user_id,
    ...(event.aliases ?? []),
  ]
    .filter((id) => typeof id === "string")
    .find(isUuid);
}

/** Subscription columns implied by one lifecycle event (see docs/subscription-api.md). */
function patchFromEvent(event: TLifecycleEvent): TSubscriptionPatch {
  const flags = REVENUECAT_EVENT_FLAGS[event.type];
  const tier = tierFromEntitlements(event.entitlement_ids);
  if (!tier) {
    // The product is not attached to a known entitlement: the stored tier is
    // kept, which on a first purchase means a paying user stays `free`.
    console.warn(
      JSON.stringify({
        log: "rc_webhook_no_tier",
        id: event.id,
        productId: event.product_id,
        entitlementIds: event.entitlement_ids,
      }),
    );
  }
  return {
    p_tier: tier,
    p_expires_at:
      event.expiration_at_ms == null
        ? undefined
        : toIso(event.expiration_at_ms),
    p_grace_expires_at:
      flags.billingIssue && event.grace_period_expiration_at_ms != null
        ? toIso(event.grace_period_expiration_at_ms)
        : undefined,
    p_period_type: event.period_type ?? undefined,
    p_store: event.store ?? undefined,
    p_product_id: event.new_product_id ?? event.product_id ?? undefined,
    p_will_renew: flags.willRenew,
    p_billing_issue: flags.billingIssue,
    p_is_trial: event.period_type === "TRIAL",
  };
}

/** Keeps an audit row for events that could not be applied to a user. */
async function recordUnappliedEvent(
  admin: TSupabaseAdminClient,
  event: TLifecycleEvent | TTransferEvent,
  payload: Json,
) {
  const appUserId =
    "app_user_id" in event
      ? event.app_user_id
      : (event.transferred_to[0] ?? event.transferred_from[0] ?? null);
  const { error } = await admin.from("revenuecat_event").upsert(
    {
      id: event.id,
      type: event.type,
      app_user_id: appUserId,
      environment: event.environment,
      event_at: toIso(event.event_timestamp_ms),
      payload,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

async function applyLifecycle(
  admin: TSupabaseAdminClient,
  event: TLifecycleEvent,
  environment: TRevenuecatEnvironment,
  payload: Json,
): Promise<TWebhookOutcome> {
  if (event.environment !== environment) return "ignored_environment";
  const userId = resolveUserId(event);
  if (!userId) {
    await recordUnappliedEvent(admin, event, payload);
    return "unknown_user";
  }

  const { data, error } = await admin.rpc("apply_subscription_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_at: toIso(event.event_timestamp_ms),
    p_user_id: userId,
    p_app_user_id: event.app_user_id,
    p_environment: event.environment,
    p_payload: payload,
    ...patchFromEvent(event),
  });
  // A well-formed uuid that is not in auth.users (deleted account).
  if (error?.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION) {
    await recordUnappliedEvent(admin, event, payload);
    return "unknown_user";
  }
  if (error) throw new Error(error.message);
  return rpcOutcomeSchema.parse(data);
}

async function applyTransfer(
  admin: TSupabaseAdminClient,
  event: TTransferEvent,
  environment: TRevenuecatEnvironment,
  payload: Json,
): Promise<TWebhookOutcome> {
  if (event.environment !== environment) return "ignored_environment";
  const from = event.transferred_from.filter(isUuid);
  const to = event.transferred_to.filter(isUuid);
  if (from.length === 0 && to.length === 0) {
    await recordUnappliedEvent(admin, event, payload);
    return "unknown_user";
  }

  const { data, error } = await admin.rpc("transfer_subscription", {
    p_event_id: event.id,
    p_event_at: toIso(event.event_timestamp_ms),
    p_from: from,
    p_to: to,
    p_payload: payload,
  });
  if (error?.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION) {
    await recordUnappliedEvent(admin, event, payload);
    return "unknown_user";
  }
  if (error) throw new Error(error.message);
  return rpcOutcomeSchema.parse(data);
}

const isKnownEventType = (type: string) =>
  type === "TRANSFER" || lifecycleEventTypeSchema.safeParse(type).success;

/**
 * Applies one webhook event to `user_profile`. Every outcome is an
 * acknowledgement; only unexpected errors throw (RevenueCat then retries).
 * A known event type whose payload fails validation also throws: acking it
 * would lose a real purchase, and the retry makes the mismatch visible.
 */
export async function handleRevenuecatEvent(
  admin: TSupabaseAdminClient,
  event: TRevenuecatEvent,
  environment: TRevenuecatEnvironment,
): Promise<TWebhookOutcome> {
  const payload = toJson(event);
  console.log(payload);

  const lifecycle = lifecycleEventSchema.safeParse(event);
  if (lifecycle.success) {
    return applyLifecycle(admin, lifecycle.data, environment, payload);
  }
  const transfer = transferEventSchema.safeParse(event);
  if (transfer.success) {
    return applyTransfer(admin, transfer.data, environment, payload);
  }
  if (isKnownEventType(event.type)) {
    const issues = event.type === "TRANSFER" ? transfer.error : lifecycle.error;
    throw new Error(
      `RevenueCat ${event.type} ${event.id} failed validation: ${z.prettifyError(issues)}`,
    );
  }
  return "ignored_type";
}
