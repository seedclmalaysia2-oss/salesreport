-- 0013_grant_execute_on_helpers.sql
--
-- current_user_is_admin() and current_user_visible_sps() are invoked by every
-- RLS policy that gates admin or scope-based reads. They were created with
-- SECURITY DEFINER but no explicit GRANT EXECUTE — Supabase revokes PUBLIC's
-- execute right on public.* functions by default, so authenticated users
-- couldn't call them. Every RLS check on sp_user_map / customers_data /
-- brand_sales_data / data_files would then fail with:
--
--   "permission denied for function current_user_is_admin"
--
-- which surfaced in App.jsx as the "Account not ready" screen right after
-- login — the auth session was fine, the profile read blew up because of the
-- missing grant.
--
-- Also (re)grant execute on the two replace-scope RPCs so an admin can invoke
-- them from the browser via supabase.rpc().
--
-- Idempotent: grants are safe to reapply, and no data changes.

grant execute on function public.current_user_is_admin()    to authenticated, anon;
grant execute on function public.current_user_visible_sps() to authenticated, anon;

-- Only re-grant the replace RPCs if they exist (they come from 0011 which may
-- not have been applied yet on some environments; skip cleanly if missing).
do $$ begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'replace_customers_data'
  ) then
    execute 'grant execute on function public.replace_customers_data(text, int, jsonb) to authenticated';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'replace_brand_sales_data'
  ) then
    execute 'grant execute on function public.replace_brand_sales_data(text, int, jsonb) to authenticated';
  end if;
end $$;
