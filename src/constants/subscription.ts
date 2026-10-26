import type { TLifecycleEventType } from "@/types/subscription";

/**
 * Monthly AI limits per paid tier (Asia/Kuala_Lumpur calendar month). Yearly
 * plans get the same monthly limits. Free users have no AI access. Passed into
 * the `consume_ai_usage` RPC, so the numbers live only here.
 */
export const AI_LIMITS = {
  plus: { chat: 200, scan: 60 },
  pro: { chat: 600, scan: 200 },
} as const;

/** Where the monthly quota period is computed; matches the RPC and purge job. */
export const USAGE_TIMEZONE = "Asia/Kuala_Lumpur";

/**
 * Renewal/billing flags implied by each RevenueCat lifecycle event. Keyed by
 * the full event enum so adding an event type is a compile error here.
 */
export const REVENUECAT_EVENT_FLAGS: Record<
  TLifecycleEventType,
  { willRenew: boolean; billingIssue: boolean }
> = {
  INITIAL_PURCHASE: { willRenew: true, billingIssue: false },
  RENEWAL: { willRenew: true, billingIssue: false },
  UNCANCELLATION: { willRenew: true, billingIssue: false },
  SUBSCRIPTION_EXTENDED: { willRenew: true, billingIssue: false },
  PRODUCT_CHANGE: { willRenew: true, billingIssue: false },
  BILLING_ISSUE: { willRenew: true, billingIssue: true },
  CANCELLATION: { willRenew: false, billingIssue: false },
  SUBSCRIPTION_PAUSED: { willRenew: false, billingIssue: false },
  EXPIRATION: { willRenew: false, billingIssue: false },
};
