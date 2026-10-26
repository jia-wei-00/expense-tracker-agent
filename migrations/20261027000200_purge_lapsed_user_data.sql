-- Retention under local-first: free users keep their data on the device and
-- have no cloud rows, so retention only concerns lapsed subscribers. 90 days
-- after the plan (or its billing grace) ended, delete everything they stored.
-- user_profile stays (trial_used must survive so a returning user does not get
-- a second trial) and so does whatsapp_users (no re-verification on return).
-- Replaces purge_free_user_expenses (two-month expense-only purge).
--
-- Caveats:
-- * Deleting storage.objects rows removes the metadata; the bytes may linger in
--   the bucket. Move audio cleanup to a worker job via the Storage API if that
--   matters.
-- * chat-images are stored as <millis>-<rand>.jpg with no user prefix and
--   cannot be attributed, so they are left alone until the upload path changes.
-- The function was created but its cron job was never scheduled in production,
-- so unschedule only if present.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-free-user-expenses';
drop function if exists public.purge_free_user_expenses();

create function public.purge_lapsed_user_data() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare
  purged integer;
begin
  create temp table lapsed on commit drop as
    select user_id
    from public.user_profile
    where expires_at is not null  -- has held a plan at some point
      and greatest(
            coalesce(expires_at, 'epoch'::timestamptz),
            coalesce(grace_expires_at, 'epoch'::timestamptz)
          ) < now() - interval '90 days';

  -- FK order: records before loans, dependants before categories.
  delete from public.loan_record       where user_id in (select user_id from lapsed);
  delete from public.loan              where user_id in (select user_id from lapsed);
  delete from public.budget            where user_id in (select user_id from lapsed);
  delete from public.recurring_expense where user_id in (select user_id from lapsed);
  delete from public.expense           where user_id in (select user_id from lapsed);
  delete from public.expense_category  where user_id in (select user_id from lapsed);
  delete from public.chat_session      where user_id in (select user_id from lapsed); -- chat_message cascades
  delete from storage.objects
   where bucket_id = 'chat-audio'
     and split_part(name, '/', 1) in (select user_id::text from lapsed);

  select count(*) into purged from lapsed;
  raise log 'purge_lapsed_user_data purged % users', purged;

  -- Webhook audit log is for debugging only; cap it so it does not grow with time.
  delete from public.revenuecat_event where received_at < now() - interval '90 days';

  return purged;
end;
$$;

revoke execute on function public.purge_lapsed_user_data() from public, anon, authenticated;

-- 21:00 UTC = 05:00 Asia/Kuala_Lumpur, away from process-recurring-expenses (22:00 UTC).
select cron.schedule(
  'purge-lapsed-user-data',
  '0 21 * * *',
  $$select public.purge_lapsed_user_data()$$
);
