-- Push tokens moved to user_profile in 20261026000000_user_profile.sql.
-- Apply this only after the WhatsApp worker (expense-tracker-ai-worker,
-- worker/src/services/whatsapp/confirm.ts) reads user_profile.push_token
-- instead of whatsapp_users.push_token. It also removes the interim
-- dual-write added in 20261026000300_push_token_dual_write.sql.
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

alter table public.whatsapp_users
  drop column push_token,
  drop column push_platform;
