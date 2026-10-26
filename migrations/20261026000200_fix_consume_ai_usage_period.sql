-- `consume_ai_usage` returns a column named `period`, which PL/pgSQL also
-- treats as a variable, so `on conflict (user_id, period)` was ambiguous and
-- raised 42702 on the first paid call. Resolve names to columns inside the
-- function body; every variable it uses is prefixed `v_`/`p_`, so nothing else
-- changes.
create or replace function public.consume_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_plus_limit integer,
  p_pro_limit integer
) returns table (tier text, allowed boolean, used integer, quota integer, period text)
language plpgsql security definer set search_path = 'public' as $$
#variable_conflict use_column
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
