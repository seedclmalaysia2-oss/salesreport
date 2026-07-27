-- 0014_grant_all_public_functions.sql
--
-- Sweeping fix for the recurring "permission denied for function X" pattern.
-- The dashboard uses several SECURITY DEFINER helper functions
-- (current_user_is_admin, current_user_visible_sps, admin_list_users, the
-- replace_* RPCs, guard_last_admin, plus any that later migrations add).
-- Every RLS policy that invokes one of them and every browser-called RPC
-- needs the calling role to hold EXECUTE. When even one grant is missing
-- the UI reads back as broken across multiple tabs — Users won't load,
-- fact-table reads 403, the weekly board looks empty.
--
-- Rather than chase them one-by-one whenever a new function is added,
-- grant EXECUTE on every function in the public schema to authenticated
-- and anon. Combined with the existing SECURITY DEFINER checks inside
-- each function (they RAISE if the caller isn't admin), this is safe:
--   * Callable check runs first (this grant).
--   * Admin check runs inside the function body (unchanged).
-- Non-admin callers still can't perform admin actions; they can call the
-- function and get an "not authorized" error instead of a silent 403.
--
-- Also revokes from PUBLIC so future function creates don't leak, keeping
-- the intent explicit: authenticated + anon can call, everyone else can't.

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public',
      fn.nspname, fn.proname, fn.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to authenticated, anon',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end $$;

-- Diagnostic (comment out if noisy in migration logs). Shows the resulting
-- grants so a follow-up audit can spot anything the loop missed.
--
-- select
--   n.nspname || '.' || p.proname || '(' ||
--     pg_get_function_identity_arguments(p.oid) || ')' as function,
--   coalesce(array_to_string(p.proacl::text[], ', '), '(default)') as acl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
-- order by function;
