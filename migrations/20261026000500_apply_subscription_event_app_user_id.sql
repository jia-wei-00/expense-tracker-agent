-- Store RevenueCat's raw app_user_id on the audit row instead of the resolved
-- uuid, so events for anonymous or aliased ids can be traced. Adding a
-- parameter means a new signature: drop the old one so PostgREST sees a
-- single function.
drop function public.apply_subscription_event(
  text, text, timestamptz, uuid, text, boolean, boolean, boolean, jsonb,
  text, timestamptz, timestamptz, text, text, text
);

create function public.apply_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_user_id uuid,
  p_environment text,
  p_will_renew boolean,
  p_billing_issue boolean,
  p_is_trial boolean,
  p_payload jsonb,
  p_tier text default null,
  p_expires_at timestamptz default null,
  p_grace_expires_at timestamptz default null,
  p_period_type text default null,
  p_store text default null,
  p_product_id text default null,
  p_app_user_id text default null
) returns text
language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.revenuecat_event (id, type, app_user_id, environment, event_at, payload)
  values (p_event_id, p_event_type, coalesce(p_app_user_id, p_user_id::text), p_environment, p_event_at, p_payload)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  insert into public.user_profile as p (
    user_id, tier, expires_at, grace_expires_at, period_type, store, product_id,
    will_renew, billing_issue, trial_used, environment, last_event_id, last_event_at
  ) values (
    p_user_id, coalesce(p_tier, 'free'), p_expires_at, p_grace_expires_at, p_period_type,
    p_store, p_product_id, p_will_renew, p_billing_issue, p_is_trial, p_environment,
    p_event_id, p_event_at
  )
  on conflict (user_id) do update set
    tier = coalesce(p_tier, p.tier),          -- null entitlement_ids: keep tier
    expires_at = p_expires_at,
    grace_expires_at = p_grace_expires_at,
    period_type = p_period_type,
    store = p_store,
    product_id = p_product_id,
    will_renew = p_will_renew,
    billing_issue = p_billing_issue,
    trial_used = p.trial_used or p_is_trial,  -- sticky
    environment = p_environment,
    last_event_id = p_event_id,
    last_event_at = p_event_at,
    updated_at = now()
  where p.last_event_at is null or p.last_event_at <= p_event_at;
  if not found then
    return 'stale';
  end if;

  return 'applied';
end;
$$;

revoke execute on function public.apply_subscription_event(
  text, text, timestamptz, uuid, text, boolean, boolean, boolean, jsonb,
  text, timestamptz, timestamptz, text, text, text, text
) from public, anon, authenticated;
