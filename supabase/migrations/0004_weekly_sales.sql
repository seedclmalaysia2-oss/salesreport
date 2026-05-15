-- Weekly sales update — one row per (period, salesperson). Admin uploads
-- weekly; all authenticated users can read so everyone sees the same number.

create table if not exists public.weekly_sales (
  id           bigserial primary key,
  period_start date    not null,
  period_end   date    not null,
  sp           text    not null,
  amount       numeric not null default 0,
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid references auth.users(id),
  unique (period_start, period_end, sp)
);

create index if not exists weekly_sales_period_end_idx on public.weekly_sales (period_end desc);

alter table public.weekly_sales enable row level security;

-- All authenticated users can read (no SP scoping — this is a shared status board)
drop policy if exists weekly_sales_read_all on public.weekly_sales;
create policy weekly_sales_read_all on public.weekly_sales
  for select using (auth.uid() is not null);

-- Only admins can write
drop policy if exists weekly_sales_admin_insert on public.weekly_sales;
create policy weekly_sales_admin_insert on public.weekly_sales
  for insert with check (public.current_user_is_admin());

drop policy if exists weekly_sales_admin_update on public.weekly_sales;
create policy weekly_sales_admin_update on public.weekly_sales
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists weekly_sales_admin_delete on public.weekly_sales;
create policy weekly_sales_admin_delete on public.weekly_sales
  for delete using (public.current_user_is_admin());
