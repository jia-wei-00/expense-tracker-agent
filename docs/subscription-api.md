# Subscriptions — client contract

Subscriptions are sold through RevenueCat (App Store / Play Store). The backend
owns the subscription state: a RevenueCat webhook writes `user_profile`, the
`/ai` routes read it, and clients read it directly from Supabase under RLS.

| Plan | Monthly | Yearly | RevenueCat entitlement |
|---|---|---|---|
| Plus | RM20 | RM200 | `plus` |
| Pro | RM50 | RM500 | `pro` |

Free users have no AI access and keep their data on the device only; cloud
storage and sync start with a paid plan (see **Retention**). The Pro plan offers
a store free trial; the store decides eligibility.

## Client flow

1. Sign in with Supabase, then identify the user to RevenueCat **before**
   showing the paywall, so purchases are never attributed to an anonymous id:

   ```kotlin
   Purchases.sharedInstance.logIn(supabaseUserId)   // Android
   ```
   ```swift
   Purchases.shared.logIn(supabaseUserId)           // iOS
   ```

2. Purchase / restore through the RevenueCat SDK as usual.
3. RevenueCat calls the backend webhook within seconds. Re-read `user_profile`
   (or subscribe to it with Realtime) to refresh the UI; do not trust the SDK's
   `customerInfo` alone for server-gated features.
4. Trial availability comes from the SDK
   (`checkTrialOrIntroductoryPriceEligibility` on iOS, the offering's free phase
   on Android). `user_profile.trial_used` is informational copy only.

## Reading state from Supabase

RLS limits every table below to the signed-in user. Clients cannot write them.

```ts
// Full subscription state (missing row = free). Also holds the push token.
supabase.from("user_profile").select("tier, expires_at, grace_expires_at, period_type, will_renew, billing_issue, trial_used").maybeSingle();

// One row for any non-free tier, including lapsed ones: the plan is active
// only while `entitled_until` is in the future. Prefer this over `tier`.
supabase.from("user_entitlement").select("tier, entitled_until").maybeSingle();

// This month's AI usage (period is the Asia/Kuala_Lumpur calendar month).
supabase.from("ai_usage").select("chat_count, scan_count").eq("period", "2026-10").maybeSingle();
```

`user_profile` columns:

| Column | Meaning |
|---|---|
| `tier` | `free` / `plus` / `pro` as last reported. Check `user_entitlement` (or `expires_at`) for whether it is active. |
| `expires_at` | End of the current period. `will_renew` says whether the store will bill again. |
| `grace_expires_at` | Set while a billing issue is in its grace period; access continues until then. |
| `period_type` | `TRIAL`, `INTRO`, `NORMAL`, `PROMOTIONAL`, `PREPAID`. |
| `billing_issue` | The last renewal failed; prompt the user to fix payment. |
| `trial_used` | The user has started a trial at some point (sticky). |

`user_profile` and `ai_usage` are in the Realtime publication, so a client may
subscribe to `postgres_changes` on its own rows instead of polling.

Push tokens are set with the existing RPCs, which now write `user_profile`:

```ts
supabase.rpc("set_push_token", { p_token, p_platform: "ios" });
supabase.rpc("clear_push_token");
```

## AI limits

Per Asia/Kuala_Lumpur calendar month; yearly plans have the same monthly limits.

| Tier | Chat messages (`POST /ai/chat` with `message`) | Receipt scans (`POST /ai/scan`) |
|---|---|---|
| free | 0 | 0 |
| plus | 200 | 60 |
| pro | 600 | 200 |

Approval replies (`POST /ai/chat` with `approvals`) are not counted. A chat
unit is consumed only after the request is validated and before anything is
stored, so a 402/429 leaves no session or message behind. A scan unit is
consumed before the model runs, so a 422 "Could not read receipt" still costs
one.

**Errors** (`application/problem+json`):

| Status | When | Body extras |
|---|---|---|
| 402 | No active plan (`title: "Subscription required"`) — open the paywall | — |
| 429 | Monthly limit reached (`title: "Monthly AI limit reached"`) | `kind`, `used`, `quota`, `period`, `tier` |

```json
{ "status": 429, "title": "Monthly AI limit reached", "detail": "Used 200/200 chats for 2026-10; resets on the 1st (Asia/Kuala_Lumpur).",
  "kind": "chat", "used": 200, "quota": 200, "period": "2026-10", "tier": "plus" }
```

A downgrade applies the lower limit immediately; an upgrade applies the higher
limit immediately and keeps this month's counts.

## Retention (lapsed subscribers)

Free users store everything on the device and have no cloud rows. When a plan
gains entitlement the app uploads its local rows through the
`import_local_data(payload jsonb)` RPC (idempotent on each table's
`client_id`). Every day at 05:00 Asia/Kuala_Lumpur,
`purge_lapsed_user_data()` deletes all data (expenses, categories, budgets,
loans, recurring expenses, chat history, chat audio) of users whose plan and
billing grace ended more than 90 days ago. `user_profile` (keeps
`trial_used` and the WhatsApp link) is not deleted. Re-subscribing within
the window keeps the cloud copy; after it, the app re-uploads from the device.

## Backend reference

- Webhook: `POST /webhooks/revenuecat`, authenticated by the `Authorization`
  header configured in the RevenueCat dashboard (`REVENUECAT_WEBHOOK_AUTH`).
  Events from a different `environment` than `REVENUECAT_ENVIRONMENT` are
  acknowledged and ignored. Duplicate and out-of-order deliveries are handled
  by the `apply_subscription_event` RPC.
- Tier is derived from `event.entitlement_ids` (`pro` wins over `plus`).
