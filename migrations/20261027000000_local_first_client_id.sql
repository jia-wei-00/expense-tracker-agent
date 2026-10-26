-- Local-first sync: every row of the five locally stored tables gets a
-- device-generated id so the upgrade import (import_local_data) is idempotent
-- and devices can match rows without knowing the server's bigint id.
-- Server-side inserts (AI tools, WhatsApp, recurring cron) take the default.
alter table public.expense          add column client_id uuid not null default gen_random_uuid();
alter table public.expense_category add column client_id uuid not null default gen_random_uuid();
alter table public.budget           add column client_id uuid not null default gen_random_uuid();
alter table public.loan             add column client_id uuid not null default gen_random_uuid();
alter table public.loan_record      add column client_id uuid not null default gen_random_uuid();

create unique index expense_user_client_id_key          on public.expense (user_id, client_id);
create unique index expense_category_user_client_id_key on public.expense_category (user_id, client_id);
create unique index budget_user_client_id_key           on public.budget (user_id, client_id);
create unique index loan_user_client_id_key             on public.loan (user_id, client_id);
create unique index loan_record_user_client_id_key      on public.loan_record (user_id, client_id);

-- Paid devices mirror these tables locally and rely on realtime for live
-- changes; expense, expense_category, loan and loan_record are already published.
alter publication supabase_realtime add table public.budget;
