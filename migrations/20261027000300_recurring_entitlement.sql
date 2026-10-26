-- Recurring expenses are a paid feature. The process-recurring-expenses pg_cron
-- job (22:00 UTC) must skip users without an active plan, otherwise a lapsed
-- user keeps accumulating cloud expenses that their device no longer pulls,
-- until purge_lapsed_user_data removes them. Body captured from the live
-- database on 2026-10-27; the only change is the entitlement filter.
create or replace function public.process_recurring_expenses()
returns void
language plpgsql security definer set search_path = 'public' as $$
declare
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  with due as (
    select r.id, r.user_id, r.name, r.amount, r.category, r.is_expense
    from public.recurring_expense r
    where r.is_active
      and r.day_of_month <= extract(day from today)::int
      and (r.last_run_date is null or r.last_run_date < date_trunc('month', today)::date)
      and exists (
        select 1 from public.user_entitlement u
        where u.user_id = r.user_id and u.entitled_until > now()
      )
  ), inserted as (
    insert into public.expense (user_id, name, amount, category, is_expense, spend_date)
    select user_id, name, amount, category, is_expense, now()
    from due
    returning 1
  )
  update public.recurring_expense r
  set last_run_date = today
  where r.id in (select id from due);
end;
$$;
