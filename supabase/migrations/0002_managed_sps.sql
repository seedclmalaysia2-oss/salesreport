-- Adds a per-user "managed teams" list. A user with managed_sps = '{Khen,Dino}'
-- can see their own team plus Khen's and Dino's data, without being a full admin.

alter table public.sp_user_map
  add column if not exists managed_sps text[] not null default '{}';

create or replace function public.current_user_visible_sps()
returns text[] language sql stable security definer set search_path = public, auth as $$
  select array_remove(
    array_append(coalesce(managed_sps, '{}'::text[]), sp),
    null
  )
  from public.sp_user_map where user_id = auth.uid()
$$;

drop policy if exists customers_data_scoped_read on public.customers_data;
create policy customers_data_scoped_read on public.customers_data
  for select using (
    public.current_user_is_admin()
    or sp = any(public.current_user_visible_sps())
  );

drop policy if exists brand_sales_data_scoped_read on public.brand_sales_data;
create policy brand_sales_data_scoped_read on public.brand_sales_data
  for select using (
    public.current_user_is_admin()
    or sp = any(public.current_user_visible_sps())
  );
