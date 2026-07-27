-- 0010_admin_writes_on_fact_tables.sql
--
-- customers_data and brand_sales_data had only SELECT policies, which meant
-- every uploaded workbook only archived into data_files — the charts (which
-- read from these fact tables) never saw the new numbers. Grant admins insert
-- + delete so the client can replay a file's parsed rows into the fact tables
-- in-place: DELETE for that file's (sp, year) scope, then INSERT the fresh
-- rows. sales_targets gets the same treatment for parity, since the same
-- Recalculate button could later push targets from a workbook too.

alter table public.customers_data     enable row level security;
alter table public.brand_sales_data   enable row level security;

-- customers_data
drop policy if exists customers_data_admin_insert on public.customers_data;
create policy customers_data_admin_insert on public.customers_data
  for insert with check (public.current_user_is_admin());

drop policy if exists customers_data_admin_delete on public.customers_data;
create policy customers_data_admin_delete on public.customers_data
  for delete using (public.current_user_is_admin());

drop policy if exists customers_data_admin_update on public.customers_data;
create policy customers_data_admin_update on public.customers_data
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- brand_sales_data
drop policy if exists brand_sales_data_admin_insert on public.brand_sales_data;
create policy brand_sales_data_admin_insert on public.brand_sales_data
  for insert with check (public.current_user_is_admin());

drop policy if exists brand_sales_data_admin_delete on public.brand_sales_data;
create policy brand_sales_data_admin_delete on public.brand_sales_data
  for delete using (public.current_user_is_admin());

drop policy if exists brand_sales_data_admin_update on public.brand_sales_data;
create policy brand_sales_data_admin_update on public.brand_sales_data
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
