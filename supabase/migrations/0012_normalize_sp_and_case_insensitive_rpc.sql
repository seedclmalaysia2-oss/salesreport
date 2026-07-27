-- 0012_normalize_sp_and_case_insensitive_rpc.sql
--
-- Two related bugs the Recalculate flow surfaced:
--
--  1. The seed data holds BOTH "Seed Malaysia" and "SEED Malaysia" (case
--     variants) for some years. replace_customers_data / replace_brand_sales_data
--     did an exact-case DELETE, which only cleared one variant. INSERT then
--     added the new rows as the canonical "Seed Malaysia", so the year showed
--     the totals of both the leftover ALL-CAPS variant and the new rows —
--     duplication.
--
--  2. If a file that WINS a (sp, year) scope has no rows (rare — happens when
--     an old upload was archived before we stored rows_json), the RPC deleted
--     the seed data for that scope and inserted zero rows in its place, so the
--     scope vanished from the charts — the reported "missing 2026".
--
-- This migration:
--   * Normalises existing rows: trims sp, collapses case variants of
--     'Seed Malaysia' to the canonical form, and generally cleans up any
--     stray whitespace differences the seed left behind.
--   * Rewrites the two RPCs so DELETE matches on (trim(lower(sp)),
--     year) — catches every case/whitespace variant — and refuses to run at
--     all when the payload is empty. That refusal is the safety valve: an
--     upload with no rows can no longer wipe a scope.

-- ------------------------------------------------------------
-- 1. Data cleanup: normalise sp so case variants collapse.
-- ------------------------------------------------------------
update public.customers_data
   set sp = 'Seed Malaysia'
 where trim(lower(sp)) = 'seed malaysia'
   and sp <> 'Seed Malaysia';

update public.brand_sales_data
   set sp = 'Seed Malaysia'
 where trim(lower(sp)) = 'seed malaysia'
   and sp <> 'Seed Malaysia';

-- General trim in case any other rows carry leading/trailing whitespace.
update public.customers_data   set sp = trim(sp) where sp <> trim(sp);
update public.brand_sales_data set sp = trim(sp) where sp <> trim(sp);

-- ------------------------------------------------------------
-- 2. RPCs with case/whitespace-insensitive DELETE + empty-guard.
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
  v_norm_sp  text := trim(lower(coalesce(p_sp, '')));
  v_size     int  := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
begin
  if not public.current_user_is_admin() then
    raise exception 'replace_customers_data: caller is not an admin';
  end if;
  if v_norm_sp = '' or p_year is null then
    raise exception 'replace_customers_data: sp and year are required';
  end if;
  -- Safety: refuse to wipe a scope when the caller has no rows to put back.
  -- Callers that actually want a scope emptied can DELETE explicitly.
  if v_size = 0 then
    raise exception 'replace_customers_data: refusing to overwrite % % with empty payload', p_sp, p_year;
  end if;

  delete from public.customers_data
   where trim(lower(sp)) = v_norm_sp
     and year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.customers_data (sp, year, customer, months, total)
  select
    trim(p_sp),
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
  v_norm_sp  text := trim(lower(coalesce(p_sp, '')));
  v_size     int  := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
begin
  if not public.current_user_is_admin() then
    raise exception 'replace_brand_sales_data: caller is not an admin';
  end if;
  if v_norm_sp = '' or p_year is null then
    raise exception 'replace_brand_sales_data: sp and year are required';
  end if;
  if v_size = 0 then
    raise exception 'replace_brand_sales_data: refusing to overwrite % % with empty payload', p_sp, p_year;
  end if;

  delete from public.brand_sales_data
   where trim(lower(sp)) = v_norm_sp
     and year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.brand_sales_data (sp, year, customer, brand, amt, qty)
  select
    trim(p_sp),
    p_year,
    trim((r->>'customer'))::text,
    trim((r->>'brand'))::text,
    coalesce((r->>'amt')::numeric, 0),
    coalesce((r->>'qty')::numeric, 0)
  from jsonb_array_elements(p_rows) r
  where (r->>'customer') is not null and trim(r->>'customer') <> ''
    and (r->>'brand')    is not null and trim(r->>'brand')    <> '';
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

grant execute on function public.replace_customers_data(text, int, jsonb) to authenticated;
grant execute on function public.replace_brand_sales_data(text, int, jsonb) to authenticated;
