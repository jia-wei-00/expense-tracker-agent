-- One-off before the local-first switch: every existing account gets a
-- 1-year promotional Pro plan so their cloud data keeps syncing and is never
-- treated as lapsed. last_event_at stays null, so a real RevenueCat event
-- later overwrites the row (apply_subscription_event's out-of-order guard).
insert into public.user_profile as p
  (user_id, tier, expires_at, grace_expires_at, period_type, store, will_renew, billing_issue, updated_at)
select id, 'pro', now() + interval '1 year', null, 'PROMOTIONAL', 'promotional', false, false, now()
from auth.users
on conflict (user_id) do update set
  tier = 'pro',
  expires_at = excluded.expires_at,
  grace_expires_at = null,
  period_type = 'PROMOTIONAL',
  store = 'promotional',
  will_renew = false,
  billing_issue = false,
  updated_at = now();
