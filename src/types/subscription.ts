import type {
  lifecycleEventSchema,
  lifecycleEventTypeSchema,
  revenuecatEnvironmentSchema,
  revenuecatWebhookSchema,
  transferEventSchema,
  webhookOutcomeSchema,
} from "@/schemas/revenuecat.schema";
import type { aiUsageKindSchema, tierSchema } from "@/schemas/subscription.schema";
import type { Database } from "@/types/database";
import type { z } from "zod";

export type TTier = z.infer<typeof tierSchema>;
export type TAiUsageKind = z.infer<typeof aiUsageKindSchema>;

export type TRevenuecatEnvironment = z.infer<typeof revenuecatEnvironmentSchema>;
export type TRevenuecatWebhook = z.infer<typeof revenuecatWebhookSchema>;
/** The loosely-typed event as received; parse it further before reading fields. */
export type TRevenuecatEvent = TRevenuecatWebhook["event"];
export type TLifecycleEventType = z.infer<typeof lifecycleEventTypeSchema>;
export type TLifecycleEvent = z.infer<typeof lifecycleEventSchema>;
export type TTransferEvent = z.infer<typeof transferEventSchema>;
export type TWebhookOutcome = z.infer<typeof webhookOutcomeSchema>;

type TApplyEventArgs =
  Database["public"]["Functions"]["apply_subscription_event"]["Args"];

/** Subscription columns implied by one lifecycle event; the service adds ids and payload. */
export type TSubscriptionPatch = Omit<
  TApplyEventArgs,
  | "p_event_id"
  | "p_event_type"
  | "p_event_at"
  | "p_user_id"
  | "p_environment"
  | "p_payload"
>;

/** One row of the `consume_ai_usage` RPC. */
export type TAiUsageResult =
  Database["public"]["Functions"]["consume_ai_usage"]["Returns"][number];
