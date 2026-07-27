-- 0011_replace_facts_rpcs.sql
--
-- Replace-scope RPCs for the fact tables. The browser calls one function per
-- (sp, year) with a JSON payload of rows; the function verifies the caller is
-- an admin, deletes the previous rows for that scope, and inserts the new
-- ones. Runs as SECURITY DEFINER so it bypasses RLS on customers_data and
-- brand_sales_data — the admin check is enforced inside the function instead,
-- which sidesteps every "why did DELETE work but INSERT fail" RLS rabbit hole
-- we hit trying to do it row-by-row from the client.
--
-- Idempotent: rerunning the migration just replaces the functions.

-- ------------------------------------------------------------
-- customers_data replace: whole-scope swap for (sp, year)
-- ------------------------------------------------------------
create or replace function public.replace_customers_data(
  p_sp   text,
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
begin
  if not public.current_user_is_admin() then
    raise exception 'replace_customers_data: caller is not an admin';
  end if;
  if p_sp is null or p_year is null then
    raise exception 'replace_customers_data: sp and year are required';
  end if;

  delete from public.customers_data where sp = p_sp and year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.customers_data (sp, year, customer, months, total)
  select
    p_sp,
    p_year,
    (r->>'customer')::text,
    (
      select array_agg((r->'months'->i)::text::numeric)
      from generate_series(0, 11) as i
    ),
    coalesce((r->>'total')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where (r->>'customer') is not null and (r->>'customer') <> '';
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

grant execute on function public.replace_customers_data(text, int, jsonb)
  to authenticated;

-- ------------------------------------------------------------
-- brand_sales_data replace: whole-scope swap for (sp, year)
-- ------------------------------------------------------------
create or replace function public.replace_brand_sales_data(
  p_sp   text,
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
begin
  if not public.current_user_is_admin() then
    raise exception 'replace_brand_sales_data: caller is not an admin';
  end if;
  if p_sp is null or p_year is null then
    raise exception 'replace_brand_sales_data: sp and year are required';
  end if;

  delete from public.brand_sales_data where sp = p_sp and year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.brand_sales_data (sp, year, customer, brand, amt, qty)
  select
    p_sp,
    p_year,
    (r->>'customer')::text,
    (r->>'brand')::text,
    coalesce((r->>'amt')::numeric, 0),
    coalesce((r->>'qty')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where (r->>'customer') is not null and (r->>'customer') <> ''
    and (r->>'brand')    is not null and (r->>'brand')    <> '';
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

grant execute on function public.replace_brand_sales_data(text, int, jsonb)
  to authenticated;
