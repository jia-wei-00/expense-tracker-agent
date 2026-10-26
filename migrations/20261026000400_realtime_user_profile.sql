-- Let clients subscribe to their own profile and usage rows with Realtime
-- (postgres_changes respects the tables' select-own RLS policies), so a
-- renewal, expiry or billing issue shows without a manual refresh.
alter publication supabase_realtime add table public.user_profile, public.ai_usage;
