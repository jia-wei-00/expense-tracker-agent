-- Per-user profile: RevenueCat subscription state + push token, one row per
-- user. Written only by SECURITY DEFINER RPCs (push token via auth.uid(),
-- subscription via the webhook using the service role); clients read their own
-- row under RLS. Missing row = free tier. Whether a plan is active is
-- `entitled_until > now()` (see the user_entitlement view), never `tier` alone.
create table public.user_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- subscription (RevenueCat)
  tier text not null default 'free' check (tier in ('free', 'plus', 'pro')),
  expires_at timestamptz,
  grace_expires_at timestamptz,                 -- BILLING_ISSUE grace period end
  period_type text check (period_type in ('TRIAL', 'INTRO', 'NORMAL', 'PROMOTIONAL', 'PREPAID')),
  store text,
  product_id text,
  will_renew boolean not null default false,
  billing_issue boolean not null default false,
  trial_used boolean not null default false,
  environment text check (environment in ('SANDBOX', 'PRODUCTION')),
  last_event_id text,
  last_event_at timestamptz,                    -- event_timestamp_ms; out-of-order guard
  -- push notifications (moved from whatsapp_users)
  push_token text,
  push_platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profile enable row level security;

create policy "users select own profile" on public.user_profile
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: only the RPCs below write.

-- Backfill push tokens so nothing is lost before whatsapp_users drops them.
insert into public.user_profile (user_id, push_token, push_platform)
select user_id, push_token, push_platform from public.whatsapp_users
on conflict (user_id) do nothing;

-- Push-token RPCs now upsert on user_profile. They used to UPDATE
-- whatsapp_users, which required a WhatsApp link to exist.
create or replace function public.set_push_token(p_token text, p_platform text default null)
returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_profile as p (user_id, push_token, push_platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (user_id) do update
    set push_token = excluded.push_token,
        push_platform = excluded.push_platform,
        updated_at = now();
end;
$$;

create or replace function public.clear_push_token()
returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  update public.user_profile
     set push_token = null,
         push_platform = null,
         updated_at = now()
   where user_id = auth.uid();
end;
$$;

-- Single definition of "active plan", shared by the AI gate, the purge job and
-- clients. security_invoker so the base table's RLS applies to client reads.
create view public.user_entitlement with (security_invoker = true) as
  select
    user_id,
    tier,
    greatest(
      coalesce(expires_at, 'epoch'::timestamptz),
      coalesce(grace_expires_at, 'epoch'::timestamptz)
    ) as entitled_until
  from public.user_profile
  where tier <> 'free';

-- Monthly AI counters. Period is the Asia/Kuala_Lumpur calendar month.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  chat_count integer not null default 0,
  scan_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.ai_usage enable row level security;

create policy "users select own usage" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);

-- Every received webhook event. PK = RevenueCat event id, which is reused on
-- retries, so a conflict means "duplicate: ack and skip". Pruned at 90 days by
-- purge_free_user_expenses().
create table public.revenuecat_event (
  id text primary key,
  type text not null,
  app_user_id text,
  environment text,
  event_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.revenuecat_event enable row level security;  -- no policies: service role only

-- Applies one lifecycle event atomically: log it (idempotency), then upsert
-- the subscription columns unless a newer event was already applied.
-- Returns 'applied' | 'duplicate' | 'stale'. Push columns are never touched.
-- Nullable columns are trailing `default null` params: the generated TS types
-- make them optional, so the Worker omits them instead of passing null.
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
  p_product_id text default null
) returns text
language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.revenuecat_event (id, type, app_user_id, environment, event_at, payload)
  values (p_event_id, p_event_type, p_user_id::text, p_environment, p_event_at, p_payload)
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

-- TRANSFER: the payload has no product data, so copy the richest source row's
-- subscription columns to every destination and end the sources' access at
-- the event time. Returns 'applied' | 'duplicate'.
create function public.transfer_subscription(
  p_event_id text,
  p_event_at timestamptz,
  p_from uuid[],
  p_to uuid[],
  p_payload jsonb
) returns text
language plpgsql security definer set search_path = 'public' as $$
declare
  src public.user_profile%rowtype;
begin
  insert into public.revenuecat_event (id, type, event_at, payload)
  values (p_event_id, 'TRANSFER', p_event_at, p_payload)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  select * into src
  from public.user_profile
  where user_id = any(p_from)
  order by greatest(coalesce(expires_at, 'epoch'), coalesce(grace_expires_at, 'epoch')) desc
  limit 1;

  update public.user_profile
     set expires_at = p_event_at,
         grace_expires_at = null,
         will_renew = false,
         last_event_id = p_event_id,
         last_event_at = p_event_at,
         updated_at = now()
   where user_id = any(p_from)
     and (last_event_at is null or last_event_at <= p_event_at);

  if src.user_id is not null then
    insert into public.user_profile as p (
      user_id, tier, expires_at, grace_expires_at, period_type, store, product_id,
      will_renew, billing_issue, trial_used, environment, last_event_id, last_event_at
    )
    select u, src.tier, src.expires_at, src.grace_expires_at, src.period_type, src.store,
           src.product_id, src.will_renew, src.billing_issue, src.trial_used, src.environment,
           p_event_id, p_event_at
    from unnest(p_to) as u
    on conflict (user_id) do update set
      tier = excluded.tier,
      expires_at = excluded.expires_at,
      grace_expires_at = excluded.grace_expires_at,
      period_type = excluded.period_type,
      store = excluded.store,
      product_id = excluded.product_id,
      will_renew = excluded.will_renew,
      billing_issue = excluded.billing_issue,
      environment = excluded.environment,
      last_event_id = excluded.last_event_id,
      last_event_at = excluded.last_event_at,
      updated_at = now()
    where p.last_event_at is null or p.last_event_at <= p_event_at;
  end if;

  return 'applied';
end;
$$;

-- Atomic tier check + monthly check-and-increment. Limits are passed in so
-- plan numbers live only in src/constants/subscription.ts. `ON CONFLICT DO
-- UPDATE` locks the row and re-evaluates WHERE on the latest tuple, so two
-- concurrent calls cannot both pass with one unit left.
create function public.consume_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_plus_limit integer,
  p_pro_limit integer
) returns table (tier text, allowed boolean, used integer, quota integer, period text)
language plpgsql security definer set search_path = 'public' as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM');
  v_tier text;
  v_quota integer;
  v_used integer;
begin
  if p_kind not in ('chat', 'scan') then
    raise exception 'unknown ai usage kind: %', p_kind;
  end if;

  select e.tier into v_tier
  from public.user_entitlement e
  where e.user_id = p_user_id and e.entitled_until > now();
  v_tier := coalesce(v_tier, 'free');
  v_quota := case v_tier when 'plus' then p_plus_limit when 'pro' then p_pro_limit else 0 end;

  if v_quota <= 0 then
    return query select v_tier, false, 0, v_quota, v_period;
    return;
  end if;

  insert into public.ai_usage as u (user_id, period, chat_count, scan_count)
  values (p_user_id, v_period, (p_kind = 'chat')::int, (p_kind = 'scan')::int)
  on conflict (user_id, period) do update set
    chat_count = u.chat_count + (p_kind = 'chat')::int,
    scan_count = u.scan_count + (p_kind = 'scan')::int,
    updated_at = now()
  where (case p_kind when 'chat' then u.chat_count else u.scan_count end) < v_quota
  returning (case p_kind when 'chat' then u.chat_count else u.scan_count end) into v_used;

  if v_used is null then  -- conditional update skipped: limit reached
    select case p_kind when 'chat' then a.chat_count else a.scan_count end into v_used
    from public.ai_usage a
    where a.user_id = p_user_id and a.period = v_period;
    return query select v_tier, false, v_used, v_quota, v_period;
    return;
  end if;

  return query select v_tier, true, v_used, v_quota, v_period;
end;
$$;

-- PostgREST exposes public functions to anon/authenticated by default; these
-- three are for the service role only.
revoke execute on function public.apply_subscription_event(
  text, text, timestamptz, uuid, text, boolean, boolean, boolean, jsonb,
  text, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
revoke execute on function public.transfer_subscription(text, timestamptz, uuid[], uuid[], jsonb)
  from public, anon, authenticated;
revoke execute on function public.consume_ai_usage(uuid, text, integer, integer)
  from public, anon, authenticated;
