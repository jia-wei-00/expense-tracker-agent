-- Fold whatsapp_users into user_profile. Both were one row per user:
-- whatsapp_users held {phone_number pk, user_id unique, is_verified} plus
-- the push columns that user_profile already took over in
-- 20261026000000_user_profile.sql. After this migration user_profile is the
-- only per-user table; whatsapp_pending_actions (transient, keyed by phone,
-- many rows per user) stays as it is.
--
-- Supersedes 20261101000000_drop_whatsapp_push_columns.sql: the dual-write
-- from 20261026000300_push_token_dual_write.sql is removed here and the whole
-- table is dropped, not just its push columns.
--
-- Breaking for the WhatsApp worker (expense-tracker-ai-worker) and the
-- clients: every reader/writer of whatsapp_users must move to the columns and
-- RPCs below before or together with applying this. Re-run cf-typegen /
-- Supabase type generation afterwards.
--
-- Writes, same model as the push token:
--   client  -> link_whatsapp(p_phone) / unlink_whatsapp()   (auth.uid())
--   worker  -> update user_profile set whatsapp_verified_at = now()
--              where whatsapp_phone = <from> and user_id = <id>   (service role)
--   worker  -> select user_id from user_profile where whatsapp_phone = <from>
--              and whatsapp_verified_at is not null

alter table public.user_profile
  add column whatsapp_phone text,            -- digits only, as Meta's wa_id
  add column whatsapp_verified_at timestamptz,
  add constraint user_profile_whatsapp_phone_digits
    check (whatsapp_phone is null or whatsapp_phone ~ '^[0-9]{6,15}$'),
  add constraint user_profile_whatsapp_verified_needs_phone
    check (whatsapp_verified_at is null or whatsapp_phone is not null);

-- One account per number; the worker looks users up by phone.
create unique index user_profile_whatsapp_phone_key
  on public.user_profile (whatsapp_phone)
  where whatsapp_phone is not null;

-- Carry over existing links (verified or not). The push columns on
-- whatsapp_users were backfilled into user_profile in 20261026000000 and kept
-- in sync by the dual-write since, so only the WhatsApp link is moved.
insert into public.user_profile as p (user_id, whatsapp_phone, whatsapp_verified_at)
select user_id,
       phone_number,
       case when is_verified then coalesce(created_at, now()) end
  from public.whatsapp_users
on conflict (user_id) do update
  set whatsapp_phone = excluded.whatsapp_phone,
      whatsapp_verified_at = excluded.whatsapp_verified_at,
      updated_at = now();

-- Link a number: replaces any previous number and resets verification, so the
-- worker's template message must be re-confirmed. The worker sends the
-- verification template after calling this.
create or replace function public.link_whatsapp(p_phone text)
returns void
language plpgsql security definer set search_path = 'public' as $$
declare
  v_phone text := regexp_replace(p_phone, '\D', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if v_phone = '' then
    raise exception 'phone required';
  end if;

  insert into public.user_profile as p (user_id, whatsapp_phone, whatsapp_verified_at)
  values (auth.uid(), v_phone, null)
  on conflict (user_id) do update
    set whatsapp_phone = excluded.whatsapp_phone,
        whatsapp_verified_at = null,
        updated_at = now();
end;
$$;

create or replace function public.unlink_whatsapp()
returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  update public.user_profile
     set whatsapp_phone = null,
         whatsapp_verified_at = null,
         updated_at = now()
   where user_id = auth.uid();
end;
$$;

grant execute on function public.link_whatsapp(text) to authenticated;
grant execute on function public.unlink_whatsapp() to authenticated;
revoke execute on function public.link_whatsapp(text) from anon, public;
revoke execute on function public.unlink_whatsapp() from anon, public;

-- Push-token RPCs: drop the interim whatsapp_users dual-write
-- (20261026000300), restoring the 20261026000000 definitions.
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

-- Policies and indexes go with the table. purge_lapsed_user_data never
-- touched whatsapp_users, so it needs no change: the link now survives on
-- user_profile exactly as before.
drop table public.whatsapp_users;
