import { z } from "zod";

/**
 * RevenueCat webhook schemas. The envelope keeps the event loose (unknown keys
 * stay `unknown`, so the whole event can be stored for debugging); the service
 * then parses it as a lifecycle or transfer event to get typed fields.
 * Field names follow https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */
export const revenuecatEnvironmentSchema = z.enum(["SANDBOX", "PRODUCTION"]);

export const periodTypeSchema = z.enum([
  "TRIAL",
  "INTRO",
  "NORMAL",
  "PROMOTIONAL",
  "PREPAID",
]);

/** Subscription lifecycle events that change `user_profile`. */
export const lifecycleEventTypeSchema = z.enum([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
  "SUBSCRIPTION_PAUSED",
  "SUBSCRIPTION_EXTENDED",
]);

const eventBase = {
  /** Reused on retries, so it doubles as the idempotency key. */
  id: z.string().min(1),
  event_timestamp_ms: z.number().int(),
};

/** `POST /webhooks/revenuecat` body. */
export const revenuecatWebhookSchema = z.object({
  api_version: z.string(),
  event: z.looseObject({ ...eventBase, type: z.string().min(1) }),
});

/**
 * Only what the service reads. RevenueCat warns that "always present" fields
 * can still be null, so everything not needed to apply the event is nullable.
 */
export const lifecycleEventSchema = z.object({
  ...eventBase,
  type: lifecycleEventTypeSchema,
  app_user_id: z.string().min(1),
  original_app_user_id: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  product_id: z.string().nullable().optional(),
  /** PRODUCT_CHANGE only: the product the user switched to. */
  new_product_id: z.string().nullable().optional(),
  entitlement_ids: z.array(z.string()).nullable().optional(),
  period_type: periodTypeSchema.nullable().optional(),
  expiration_at_ms: z.number().int().nullable().optional(),
  /** BILLING_ISSUE only. */
  grace_period_expiration_at_ms: z.number().int().nullable().optional(),
  environment: revenuecatEnvironmentSchema,
  store: z.string().nullable().optional(),
});

export const transferEventSchema = z.object({
  ...eventBase,
  type: z.literal("TRANSFER"),
  transferred_from: z.array(z.string()),
  transferred_to: z.array(z.string()),
  environment: revenuecatEnvironmentSchema,
});

/** Result of the `apply_subscription_event` / `transfer_subscription` RPCs. */
export const rpcOutcomeSchema = z.enum(["applied", "duplicate", "stale"]);

/** Every way the webhook handler can finish; all are acknowledged with 200. */
export const webhookOutcomeSchema = z.enum([
  ...rpcOutcomeSchema.options,
  "unknown_user",
  "ignored_environment",
  "ignored_type",
]);
