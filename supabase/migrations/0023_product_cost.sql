-- 0023_product_cost.sql
--
-- Cost per box for the ROI tab. The Stock Sales Analysis - Detail export carries
-- Net Cost on every line, so product_monthly_sales now keeps it alongside qty and
-- amount:
--   cost      RM net cost of the lines that carry a cost
--   cost_qty  boxes on those same lines
-- cost / cost_qty is the product's average cost per box. Trial and FOC lines are
-- booked at cost 0 and are left out of both, so they can't drag the average down.
--
-- Same RLS as before (0021), so these columns are readable by whoever can read
-- the table. Upload a Stock-Detail file again after running this: rows parsed
-- before this change have no cost. Idempotent: safe to run twice.

alter table public.product_monthly_sales
  add column if not exists cost     numeric not null default 0,
  add column if not exists cost_qty numeric not null default 0;

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

  insert into public.product_monthly_sales (year, month, sp, product, qty, amount, cost, cost_qty)
  select
    p_year,
    (r->>'month')::int,
    (r->>'sp')::text,
    (r->>'product')::text,
    coalesce((r->>'qty')::numeric, 0),
    coalesce((r->>'amount')::numeric, 0),
    coalesce((r->>'cost')::numeric, 0),
    coalesce((r->>'cost_qty')::numeric, 0)
  from jsonb_array_elements(p_rows) r
  where (r->>'sp') is not null and (r->>'sp') <> ''
    and (r->>'product') is not null and (r->>'product') <> ''
    and (r->>'month')::int between 1 and 12
  on conflict (year, month, sp, product)
    do update set qty = excluded.qty, amount = excluded.amount,
                  cost = excluded.cost, cost_qty = excluded.cost_qty,
                  updated_at = now();
  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

revoke all on function public.replace_product_monthly_sales(int, jsonb) from public, anon;
grant execute on function public.replace_product_monthly_sales(int, jsonb) to authenticated;
