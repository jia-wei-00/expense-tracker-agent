-- Interim fix: the WhatsApp worker (expense-tracker-ai-worker,
-- worker/src/services/whatsapp/confirm.ts) still reads
-- whatsapp_users.push_token to send "expense added" pushes. Until it reads
-- user_profile instead, the push-token RPCs write both tables, and tokens
-- registered since 20261026000000_user_profile.sql are copied back.
-- Remove the whatsapp_users writes together with
-- 20261101000000_drop_whatsapp_push_columns.sql once that worker is updated.
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

  update public.whatsapp_users
     set push_token = p_token,
         push_platform = p_platform
   where user_id = auth.uid();
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

  update public.whatsapp_users
     set push_token = null,
         push_platform = null
   where user_id = auth.uid();
end;
$$;

-- Re-sync tokens written to user_profile only, since the first migration.
update public.whatsapp_users w
   set push_token = p.push_token,
       push_platform = p.push_platform
  from public.user_profile p
 where p.user_id = w.user_id
   and (w.push_token is distinct from p.push_token
        or w.push_platform is distinct from p.push_platform);
