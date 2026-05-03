-- Sales Dashboard initial schema + RLS.
--
-- Apply via Supabase Studio → SQL Editor on project fgqiwitiqwftvfhkchpt.
-- DDL is idempotent — safe to run on a fresh DB.

-- ============================================================
-- 1. User-to-salesperson mapping
-- ============================================================
create table if not exists public.sp_user_map (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sp         text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table  public.sp_user_map is 'Maps an authenticated user to their salesperson scope. is_admin=true grants cross-team visibility.';
comment on column public.sp_user_map.sp is 'Salesperson display name (Alan, Dino, Khen, Sakinah, Simon, Seed Malaysia). Admins still need a value here; conventionally ''admin''.';

-- ============================================================
-- 2. Customer-level monthly facts
-- ============================================================
create table if not exists public.customers_data (
  id       bigserial primary key,
  sp       text    not null,
  year     int     not null,
  customer text    not null,
  months   numeric[] not null check (array_length(months, 1) = 12),
  total    numeric not null
);
create index if not exists customers_data_sp_year_idx on public.customers_data (sp, year);
create index if not exists customers_data_customer_idx on public.customers_data (customer);

-- ============================================================
-- 3. Customer × brand annual sales (FC / T / TR codes already filtered upstream)
-- ============================================================
create table if not exists public.brand_sales_data (
  id       bigserial primary key,
  sp       text    not null,
  year     int     not null,
  customer text    not null,
  brand    text    not null,
  amt      numeric not null
);
create index if not exists brand_sales_sp_year_idx on public.brand_sales_data (sp, year);
create index if not exists brand_sales_brand_idx   on public.brand_sales_data (brand);
create index if not exists brand_sales_customer_idx on public.brand_sales_data (customer);

-- ============================================================
-- 4. Helper functions used by RLS policies
-- ============================================================
create or replace function public.current_user_sp()
returns text language sql stable security definer set search_path = public, auth as $$
  select sp from public.sp_user_map where user_id = auth.uid()
$$;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select is_admin from public.sp_user_map where user_id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- 5. Enable RLS + policies
-- ============================================================
alter table public.sp_user_map      enable row level security;
alter table public.customers_data   enable row level security;
alter table public.brand_sales_data enable row level security;

-- sp_user_map: users see their own row; admins see all.
drop policy if exists sp_user_map_self_or_admin on public.sp_user_map;
create policy sp_user_map_self_or_admin on public.sp_user_map
  for select using (
    user_id = auth.uid() or public.current_user_is_admin()
  );

-- customers_data: scoped by SP unless admin.
drop policy if exists customers_data_scoped_read on public.customers_data;
create policy customers_data_scoped_read on public.customers_data
  for select using (
    public.current_user_is_admin() or sp = public.current_user_sp()
  );

-- brand_sales_data: same scoping.
drop policy if exists brand_sales_data_scoped_read on public.brand_sales_data;
create policy brand_sales_data_scoped_read on public.brand_sales_data
  for select using (
    public.current_user_is_admin() or sp = public.current_user_sp()
  );

-- Writes (insert/update/delete) intentionally have no policies — the seed
-- scripts use the service_role key, which bypasses RLS.
