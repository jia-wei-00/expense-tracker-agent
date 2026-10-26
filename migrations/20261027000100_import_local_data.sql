-- Upgrade upload for local-first clients: when a user gains a Plus/Pro plan the
-- app sends its on-device rows here in one call (chunked at ~1000 rows,
-- categories and loans always in the first chunk). SECURITY INVOKER so RLS
-- scopes every statement to the caller. Idempotent on (user_id, client_id):
-- rerunning after a failure or after a retention purge inserts only what is
-- missing. Categories also merge by name so a local "Food" lands on the cloud
-- "Food" instead of duplicating it. Returns {table: {client_id: id}} so the
-- device can store the server ids.
--
-- payload = {
--   "categories":   [{client_id, name, is_expense, created_at}],
--   "loans":        [{client_id, name, total_amount, interest_rate, created_at}],
--   "expenses":     [{client_id, name, amount, is_expense, spend_date, category_client_id, created_at}],
--   "budgets":      [{client_id, category_client_id | null, amount, created_at}],
--   "loan_records": [{client_id, loan_client_id, amount (text), pay_date, created_at}]
-- }
create function public.import_local_data(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = 'public' as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.user_entitlement where user_id = uid and entitled_until > now()
  ) then
    raise exception 'plan_required' using errcode = 'P0402';
  end if;

  -- 1. categories: match by client_id, then by name, else insert.
  create temp table cat_in on commit drop as
    select * from jsonb_to_recordset(coalesce(payload->'categories', '[]'::jsonb))
      as t(client_id uuid, name text, is_expense boolean, created_at timestamptz);

  create temp table cat_map on commit drop as
    select i.client_id,
           coalesce(
             (select c.id from public.expense_category c
               where c.user_id = uid and c.client_id = i.client_id),
             (select c.id from public.expense_category c
               where c.user_id = uid
                 and lower(c.name) = lower(i.name)
                 and c.is_expense is not distinct from i.is_expense
               limit 1)
           ) as id
    from cat_in i;

  with ins as (
    insert into public.expense_category (user_id, client_id, name, is_expense, created_at)
    select uid, i.client_id, i.name, i.is_expense, coalesce(i.created_at, now())
    from cat_in i join cat_map m using (client_id)
    where m.id is null
    returning id, client_id
  )
  update cat_map m set id = ins.id from ins where ins.client_id = m.client_id;

  -- 2. loans
  insert into public.loan (user_id, client_id, name, total_amount, interest_rate, created_at)
  select uid, t.client_id, t.name, t.total_amount, t.interest_rate, coalesce(t.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'loans', '[]'::jsonb))
    as t(client_id uuid, name text, total_amount float8, interest_rate float8, created_at timestamptz)
  on conflict (user_id, client_id) do nothing;

  -- 3. expenses (category_client_id -> bigint id; unknown category -> null)
  insert into public.expense (user_id, client_id, name, amount, is_expense, spend_date, category, created_at)
  select uid, t.client_id, t.name, t.amount, t.is_expense, t.spend_date, m.id, coalesce(t.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'expenses', '[]'::jsonb))
    as t(client_id uuid, name text, amount float8, is_expense boolean, spend_date timestamptz,
         category_client_id uuid, created_at timestamptz)
  left join cat_map m on m.client_id = t.category_client_id
  on conflict (user_id, client_id) do nothing;

  -- 4. budgets. Bare ON CONFLICT also skips a second budget for a category that
  --    already has one in the cloud (unique user+category) instead of failing.
  insert into public.budget (user_id, client_id, category, amount, created_at)
  select uid, t.client_id, m.id, t.amount, coalesce(t.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'budgets', '[]'::jsonb))
    as t(client_id uuid, category_client_id uuid, amount float8, created_at timestamptz)
  left join cat_map m on m.client_id = t.category_client_id
  on conflict do nothing;

  -- 5. loan records (loan_client_id -> bigint id). amount is TEXT in this table.
  --    Records whose loan is unknown are skipped.
  insert into public.loan_record (user_id, client_id, loan, amount, pay_date, created_at)
  select uid, t.client_id, l.id, t.amount, t.pay_date, coalesce(t.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'loan_records', '[]'::jsonb))
    as t(client_id uuid, loan_client_id uuid, amount text, pay_date timestamptz, created_at timestamptz)
  join public.loan l on l.user_id = uid and l.client_id = t.loan_client_id
  on conflict (user_id, client_id) do nothing;

  -- 6. id map for every client_id in the payload
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_object_agg(client_id, id), '{}'::jsonb)
                     from cat_map where id is not null),
    'loans', (select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
                from public.loan r
               where r.user_id = uid and r.client_id in (
                 select (e->>'client_id')::uuid
                 from jsonb_array_elements(coalesce(payload->'loans', '[]'::jsonb)) e)),
    'expenses', (select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
                   from public.expense r
                  where r.user_id = uid and r.client_id in (
                    select (e->>'client_id')::uuid
                    from jsonb_array_elements(coalesce(payload->'expenses', '[]'::jsonb)) e)),
    'budgets', (select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
                  from public.budget r
                 where r.user_id = uid and r.client_id in (
                   select (e->>'client_id')::uuid
                   from jsonb_array_elements(coalesce(payload->'budgets', '[]'::jsonb)) e)),
    'loan_records', (select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
                       from public.loan_record r
                      where r.user_id = uid and r.client_id in (
                        select (e->>'client_id')::uuid
                        from jsonb_array_elements(coalesce(payload->'loan_records', '[]'::jsonb)) e))
  ) into result;

  return result;
end;
$$;

revoke execute on function public.import_local_data(jsonb) from public, anon;
grant execute on function public.import_local_data(jsonb) to authenticated;
