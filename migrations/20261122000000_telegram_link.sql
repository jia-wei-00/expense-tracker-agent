-- Telegram bot, slice 1: account linking and DM sessions
-- (docs/superpowers/specs/2026-11-21-telegram-bot-design.md, section 4.1).
--
-- Additive: new nullable columns, one partial index and three new functions.
-- Nothing existing is altered or dropped, so the app and workers that do not
-- know about Telegram keep working unchanged.
--
-- Who calls what:
--   app    -> create_telegram_link_token()   (auth.uid()) shows the token as a
--             deep link / code for the user to send to the bot
--   Worker -> link_telegram(token, tg_id)    (service role only) called from the
--             Telegram webhook when the user sends the token
--   app    -> unlink_telegram()              (auth.uid()) clears the link;
--             existing Telegram sessions stay readable
-- The Worker also reads/writes chat_session.telegram_* with the service role.

alter table public.user_profile
  add column telegram_user_id bigint unique,
  add column telegram_linked_at timestamptz,
  add column telegram_link_token text unique,
  add column telegram_link_expires_at timestamptz;

alter table public.chat_session
  add column telegram_chat_id bigint,          -- not unique: sessions rotate
  add column telegram_user_id bigint;          -- who the conversation is with (DM: = chat id)

create index chat_session_telegram_idx
  on public.chat_session (telegram_chat_id, telegram_user_id, created_at desc)
  where telegram_chat_id is not null;

-- Issue a single-use token valid for 10 minutes. Replaces any earlier token.
-- 24 random bytes -> 32 base64 chars with no padding. The base64url encoding
-- name of encode() only exists from Postgres 18, so the portable form is used:
-- standard base64 with '+/' swapped for the URL-safe '-_'.
create or replace function public.create_telegram_link_token()
returns text
language plpgsql security definer set search_path = 'public' as $$
declare
  v_token text := translate(
    encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_profile as p (user_id, telegram_link_token, telegram_link_expires_at)
  values (auth.uid(), v_token, now() + interval '10 minutes')
  on conflict (user_id) do update
    set telegram_link_token = excluded.telegram_link_token,
        telegram_link_expires_at = excluded.telegram_link_expires_at,
        updated_at = now();

  return v_token;
end;
$$;

-- Bind a Telegram account to the user that issued the token. Service role
-- only: the Worker has verified the Telegram update, the token proves which
-- app user it is. Linking the same Telegram id to the same account again is
-- fine; a Telegram id already on another account raises telegram_already_linked.
create or replace function public.link_telegram(p_token text, p_telegram_user_id bigint)
returns uuid
language plpgsql security definer set search_path = 'public' as $$
declare
  v_user_id uuid;
begin
  if p_token is null then
    raise exception 'token_invalid';
  end if;

  begin
    update public.user_profile
       set telegram_user_id = p_telegram_user_id,
           telegram_linked_at = now(),
           telegram_link_token = null,
           telegram_link_expires_at = null,
           updated_at = now()
     where telegram_link_token = p_token
       and telegram_link_expires_at > now()
    returning user_id into v_user_id;
  exception when unique_violation then
    raise exception 'telegram_already_linked';
  end;

  if v_user_id is null then
    raise exception 'token_invalid';
  end if;

  return v_user_id;
end;
$$;

create or replace function public.unlink_telegram()
returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  update public.user_profile
     set telegram_user_id = null,
         telegram_linked_at = null,
         telegram_link_token = null,
         telegram_link_expires_at = null,
         updated_at = now()
   where user_id = auth.uid();
end;
$$;

revoke execute on function public.create_telegram_link_token() from public, anon;
revoke execute on function public.link_telegram(text, bigint) from public, anon, authenticated;
revoke execute on function public.unlink_telegram() from public, anon;

grant execute on function public.create_telegram_link_token() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;
grant execute on function public.link_telegram(text, bigint) to service_role;
