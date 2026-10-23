-- 0021_product_monthly_sales.sql
--
-- Month-by-month sales per product per salesperson, for the "Product trend"
-- section on the Monthly Trends tab.
--
-- The only source with month + product + salesperson on one line is the
-- Stock Sales Analysis - Detail export (data_files.kind = 'invoice'), which is
-- admin-only. This table holds its roll-up onto the HQ report products (the same
-- mapping the HQ Report tab uses, src/lib/reportProducts.js) so the whole team
-- can chart it without being able to read the uploaded workbook or its
-- invoice-level rows.
--
-- Visibility follows the other per-rep fact tables (0008): a user sees every
-- salesperson by default, or only their own + managed reps when an admin has set
-- them to "Own only" (can_view_all = false).
--
-- Writes go through replace_product_monthly_sales() — admin only, whole-year
-- swap — called from the Data tab / Weekly Refresh whenever a Stock-Detail file
-- is uploaded, updated or recalculated. Idempotent: safe to run twice.

create table if not exists public.product_monthly_sales (
  year       int         not null,
  month      int         not null check (month between 1 and 12),
  sp         text        not null,
  product    text        not null,
  qty        numeric     not null default 0,   -- boxes / bottles (report units)
  amount     numeric     not null default 0,   -- RM, net of credit notes
  updated_at timestamptz not null default now(),
  primary key (year, month, sp, product)
);

alter table public.product_monthly_sales enable row level security;

drop policy if exists product_monthly_sales_scoped_read on public.product_monthly_sales;
create policy product_monthly_sales_scoped_read on public.product_monthly_sales
  for select using (
    auth.uid() is not null
    and (
      public.current_user_can_view_all()
      or sp = any(public.current_user_visible_sps())
    )
  );

-- No insert/update/delete policies on purpose: the only writer is the
-- SECURITY DEFINER function below, which checks for admin itself.

create or replace function public.replace_product_monthly_sales(
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
    raise exception 'replace_product_monthly_sales: caller is not an admin';
  end if;
  if p_year is null then
    raise exception 'replace_product_monthly_sales: year is required';
  end if;
  -- Same guard as the other replace RPCs: a stray empty payload must never wipe
  -- a year that has data.
  if coalesce(jsonb_array_length(p_rows), 0) = 0 then
    raise exception 'replace_product_monthly_sales: refusing to replace % with zero rows', p_year;
  end if;

  delete from public.product_monthly_sales where year = p_year;
  get diagnostics v_deleted = row_count;

  insert into public.product_monthly_sales (year, month, sp, product, qty, amount)
  select
    p_year,
    (r->>'month')::int,
    (r->>'sp')::text,
    (r->>'product')::text,
    coalesce((r->>'qty')::numeric, 0),
    coalesce((r->>'amount')::numeric, 0)
  from jsonb_array_elements(p_rows) r
  where (r->>'sp') is not null and (r->>'sp') <> ''
    and (r->>'product') is not null and (r->>'product') <> ''
    and (r->>'month')::int between 1 and 12
  on conflict (year, month, sp, product)
    do update set qty = excluded.qty, amount = excluded.amount, updated_at = now();
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

revoke all on function public.replace_product_monthly_sales(int, jsonb) from public, anon;
grant execute on function public.replace_product_monthly_sales(int, jsonb) to authenticated;
