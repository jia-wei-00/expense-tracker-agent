-- Hard retention for free users: expense rows older than 2 calendar months
-- (Asia/Kuala_Lumpur day boundary) are deleted daily. "Free" = no user_profile
-- row, or an entitlement that ended more than 7 days ago (grace so a lapsed
-- renewal or a missed webhook does not wipe data the next morning).
-- Only `expense` is purged; budgets, recurring expenses, loans and chat history
-- are kept. The same run prunes the webhook audit log at 90 days.
create function public.purge_free_user_expenses() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare
  cutoff timestamp := date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') - interval '2 months';
  deleted integer;
begin
  with gone as (
    delete from public.expense e
    where coalesce(e.spend_date, e.created_at at time zone 'Asia/Kuala_Lumpur') < cutoff
      and not exists (
        select 1 from public.user_entitlement u
        where u.user_id = e.user_id and u.entitled_until > now() - interval '7 days'
      )
    returning 1
  )
  select count(*) into deleted from gone;
  raise log 'purge_free_user_expenses deleted % rows (cutoff %)', deleted, cutoff;

  -- Webhook audit log is for debugging only; cap it so it does not grow with
  -- time (about 2 KB per event with the payload).
  delete from public.revenuecat_event where received_at < now() - interval '90 days';

  return deleted;
end;
$$;

revoke execute on function public.purge_free_user_expenses() from public, anon, authenticated;

create index expense_user_spend_date_idx on public.expense (user_id, spend_date);

-- 21:00 UTC = 05:00 Asia/Kuala_Lumpur, away from process-recurring-expenses (22:00 UTC).
select cron.schedule(
  'purge-free-user-expenses',
  '0 21 * * *',
  $$select public.purge_free_user_expenses()$$
);
