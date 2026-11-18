-- 0025_replace_customers_year.sql
--
-- Whole-YEAR replace for customers_data, to stop ghost salesman scopes.
--
-- replace_customers_data (0011/0012) swaps one (sp, year) scope at a time. The
-- "Sales Analysis by Customer" export is a single year file that fans out into
-- one scope per rep via its Salesman column, so syncing it only ever REPLACES
-- the reps present in the current file. When a customer's salesman changes
-- between uploads — e.g. the admin fills in a blank Salesman cell, moving a
-- customer from "All"/"Unassigned" to "Simon" — the OLD scope is no longer in
-- the file, so it is never cleared. The stale row lingers and the customer is
-- counted twice (once under the real rep, once under the ghost bucket). This is
-- what made Nov-2026 read RM 239,372 instead of RM 239,272 ("XIN MIN OPTICAL"
-- double-counted under Simon + a ghost "Unassigned"/"All").
--
-- This RPC replaces the ENTIRE year in one shot: DELETE every row for p_year,
-- then INSERT the merged rows (each carrying its own sp). Because the year file
-- is authoritative for the whole year's attribution, nothing can be left behind.
-- Same guards as the per-scope RPC: admin-only, SECURITY DEFINER (bypasses RLS,
-- the client can't DELETE directly), and it refuses an empty payload so a stray
-- zero-row sync can't wipe a year.
--
-- Idempotent: rerunning just replaces the function.

create or replace function public.replace_customers_year(
  p_year int,
  p_rows jsonb
)
returns table(deleted int, inserted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted  int;
  v_inserted int;
  v_size     int := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
begin
  if not public.current_user_is_admin() then
    raise exception 'replace_customers_year: caller is not an admin';
  end if;
  if p_year is null then
    raise exception 'replace_customers_year: year is required';
  end if;
  -- Safety: never wipe a whole year when the caller has nothing to put back.
  if v_size = 0 then
    raise exception 'replace_customers_year: refusing to overwrite % with empty payload', p_year;
  end if;

  delete from public.customers_data where year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.customers_data (sp, year, customer, months, total)
  select
    coalesce(nullif(trim(r->>'sp'), ''), 'Unassigned'),
    p_year,
    trim((r->>'customer'))::text,
    (
      select array_agg((r->'months'->i)::text::numeric)
      from generate_series(0, 11) as i
    ),
    coalesce((r->>'total')::numeric, 0)
  from jsonb_array_elements(p_rows) r
  where (r->>'customer') is not null and trim(r->>'customer') <> '';
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

grant execute on function public.replace_customers_year(int, jsonb) to authenticated;
